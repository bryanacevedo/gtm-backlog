/* gtm-backlog API. Runtime-agnostic: the same Hono app runs under Node
   (src/server/node.ts, local and Docker) and on Cloudflare (src/server/worker.ts).
   Every write re-checks the rules in shared/domain.ts, runs in one transaction
   and records an event, so the activity feed is the audit trail. The schema
   enforces the same rules a second time (migrations/0001_init.sql). */

import { Hono, type Context } from "hono";
import type { Db } from "./db.ts";
import { safeEqual } from "./safe.ts";
import {
  TEAMS, TOUCHES, label, moveError, validateInputs,
  type EventRow, type Item, type ShipLogEntry, type Stage,
} from "../shared/domain.ts";

/** Which data space a request reaches, decided by the caller's credentials and nothing the request names. */
export interface Space {
  db: Db;
  demo: boolean;
  /** When set, writes are logged under this name and the x-actor header is ignored (a signed-in user). */
  actor?: string;
  /** Put in front of a name the caller supplies (scripts), so it cannot pass for a signed-in person. */
  actorPrefix?: string;
  /** Merged into the meta of /api/state (who is signed in, which space, what the header may offer). */
  meta?: Record<string, unknown>;
}
export interface AppConfig {
  writeKey?: string;
  demo: boolean;
  /** Hosted mode: choose the space per request (or answer with a Response, such as a refusal). */
  resolve?: (c: Context) => Promise<Space | Response>;
}
type Ctx = { Variables: { actor: string; space: Space } };

const ITEM_COLS = `id, title, problem, team, requester, touches, link, stage::text AS stage, owner, impact, reach, confidence,
  effort_days, scored_at, scored_by, system_url, target_date::text AS target_date, decision_note, merged_into, live_at,
  created_at, updated_at, stage_changed_at`;

const newId = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const isUrl = (s: unknown) => typeof s === "string" && /^https?:\/\/\S+$/.test(s);
const text = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const bad = (msg: string, status: 400 | 401 | 403 | 404 | 409 | 503 = 400) => Response.json({ error: msg }, { status });

export function createApp(getDb: () => Db | Promise<Db>, cfg: AppConfig) {
  const app = new Hono<Ctx>();
  const dbOf = (c: Context<Ctx>) => c.get("space").db;

  const one = async (q: Db["query"], id: string) =>
    (await q<Item>(`SELECT ${ITEM_COLS} FROM items WHERE id = $1`, [id]))[0] ?? null;
  const event = (q: Db["query"], item: string, actor: string, kind: EventRow["kind"], detail: string) =>
    q("INSERT INTO events (id, item_id, actor, kind, detail) VALUES ($1, $2, $3, $4, $5)", [newId("ev"), item, actor, kind, detail]);

  /* ---------------------------------------------------------- write gate */

  app.use("/api/*", async (c, next) => {
    const space = cfg.resolve ? await cfg.resolve(c) : { db: await getDb(), demo: cfg.demo };
    if (space instanceof Response) return space;
    c.set("space", space);
    if (c.req.method !== "GET") {
      if (!cfg.resolve && cfg.writeKey && !safeEqual(c.req.header("x-write-key") ?? "", cfg.writeKey))
        return bad("This backlog needs the team write key to make changes.", 401);
      const given = decodeURIComponent(c.req.header("x-actor") ?? "").trim();
      const actor = space.actor ?? (given ? (space.actorPrefix ?? "") + given : "");
      if (!actor) return bad("Tell the backlog who you are before making changes.");
      c.set("actor", actor.slice(0, 60));
    }
    await next();
  });

  app.onError((err) => {
    console.error(err);
    const msg = String((err as Error).message ?? "");
    if (msg.includes("live_needs_system")) return bad("Add the link to the shipped system before marking it live.", 409);
    if (msg.includes("closed_needs_reason")) return bad("Say why before declining or retiring it.", 409);
    return bad("Something went wrong saving that. Nothing was changed; try again.", 400);
  });

  /* ---------------------------------------------------------------- read */

  app.get("/api/state", async (c) => {
    const db = dbOf(c);
    const [items, shipLog, events] = await Promise.all([
      db.query<Item>(`SELECT ${ITEM_COLS} FROM items`),
      db.query<ShipLogEntry>("SELECT id, item_id, date::text AS date, metric, value, unit, note, source_url, created_at FROM ship_log ORDER BY date DESC, created_at DESC"),
      db.query<EventRow>("SELECT id, item_id, at, actor, kind, detail FROM events ORDER BY at DESC LIMIT 400"),
    ]);
    return c.json({ items, shipLog, events, meta: { demo: c.get("space").demo, writeKey: !cfg.resolve && Boolean(cfg.writeKey), now: new Date().toISOString(), ...c.get("space").meta } });
  });

  app.get("/api/health", async (c) => {
    const db = dbOf(c);
    const [r] = await db.query<{ v: string }>("SELECT current_setting('server_version') AS v");
    return c.json({ ok: true, postgres: r?.v });
  });

  /* ----------------------------------------------------- create request */

  app.post("/api/items", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const title = text(b.title), problem = text(b.problem), requester = text(b.requester), team = text(b.team);
    if (!title) return bad("Give the request a title.");
    if (!problem) return bad("Describe the problem in a sentence or two.");
    if (!requester) return bad("Say who is asking.");
    if (!(TEAMS as readonly string[]).includes(team)) return bad("Pick the team that is asking.");
    const touches = Array.isArray(b.touches) ? b.touches.filter((t) => (TOUCHES as readonly unknown[]).includes(t)) : [];
    const link = text(b.link) || null;
    if (link && !isUrl(link)) return bad("The link must start with http:// or https://.");
    const id = newId("bl"), actor = c.get("actor");
    const db = dbOf(c);
    const item = await db.tx(async (q) => {
      await q("INSERT INTO items (id, title, problem, team, requester, touches, link) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, title, problem, team, requester, touches, link]);
      await event(q, id, actor, "created", requester === actor ? "Submitted the request" : `Submitted the request for ${requester}`);
      return one(q, id);
    });
    return c.json({ item }, 201);
  });

  /* ---------------------------------------------------------------- edit */

  const EDITABLE = ["title", "problem", "team", "requester", "touches", "link", "owner", "impact", "reach", "confidence", "effort_days", "system_url", "target_date"] as const;
  const SCORE = new Set(["impact", "reach", "confidence", "effort_days"]);
  const NAME: Record<string, string> = { effort_days: "effort", system_url: "system link", target_date: "target date" };

  app.patch("/api/items/:id", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in b) patch[k] = b[k] === "" ? null : b[k];
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    for (const k of ["impact", "reach", "confidence", "effort_days"] as const) if (patch[k] != null) patch[k] = Number(patch[k]);
    const invalid = validateInputs(patch);
    if (invalid) return bad(invalid);
    for (const k of ["title", "problem", "requester"] as const) if (k in patch && !text(patch[k])) return bad(`The ${k} cannot be empty.`);
    if ("team" in patch && !(TEAMS as readonly unknown[]).includes(patch.team)) return bad("Pick one of the listed teams.");
    if ("touches" in patch) {
      if (!Array.isArray(patch.touches)) return bad("Touches is a list.");
      patch.touches = patch.touches.filter((t) => (TOUCHES as readonly unknown[]).includes(t));
    }
    for (const k of ["link", "system_url"] as const) if (patch[k] != null && !isUrl(patch[k])) return bad("Links must start with http:// or https://.");
    if (patch.target_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.target_date))) return bad("Use a date like 2026-12-01.");

    const actor = c.get("actor");
    const db = dbOf(c);
    const result = await db.tx(async (q) => {
      const item = await one(q, c.req.param("id"));
      if (!item) return { error: bad("That item no longer exists.", 404) };
      if ("system_url" in patch && patch.system_url == null && item.stage === "live") return { error: bad("A live item keeps its system link. Move it out of Live first.", 409) };
      const cur = item as unknown as Record<string, unknown>;
      const changed = Object.keys(patch).filter((k) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(patch[k] ?? null));
      const confirm = b.confirm_score === true && Object.keys(patch).some((k) => SCORE.has(k));
      if (!changed.length && !confirm) return { item };
      const sets: Record<string, unknown> = Object.fromEntries(changed.map((k) => [k, patch[k]]));
      const extra: string[] = ["updated_at = now()"];
      if (confirm || changed.some((k) => SCORE.has(k))) { extra.push("scored_at = now()"); sets.scored_by = actor; }
      const keys = Object.keys(sets);
      await q(`UPDATE items SET ${[...keys.map((k, i) => `${k} = $${i + 2}`), ...extra].join(", ")} WHERE id = $1`, [item.id, ...keys.map((k) => sets[k])]);
      await event(q, item.id, actor, "edited", changed.length ? `Changed ${changed.map((k) => NAME[k] ?? k).join(", ")}` : "Confirmed the score");
      return { item: await one(q, item.id) };
    });
    return "error" in result ? result.error! : c.json({ item: result.item });
  });

  /* ---------------------------------------------------------------- move */

  app.post("/api/items/:id/move", async (c) => {
    type Body = { to?: Stage; system_url?: string; note?: string; merged_into?: string; expect?: Stage };
    const b: Body = await c.req.json<Body>().catch(() => ({}));
    const to = b.to as Stage;
    if (b.system_url && !isUrl(b.system_url)) return bad("The system link must start with http:// or https://.");
    const actor = c.get("actor");
    const db = dbOf(c);
    const result = await db.tx(async (q) => {
      // Lock the row so two people moving the same card cannot both win.
      const [locked] = await q<{ id: string }>("SELECT id FROM items WHERE id = $1 FOR UPDATE", [c.req.param("id")]);
      const item = locked ? await one(q, locked.id) : null;
      if (!item) return { error: bad("That item no longer exists.", 404) };
      if (b.expect && b.expect !== item.stage) return { error: bad(`Someone moved this to ${label(item.stage)} a moment ago. Refresh to see the latest.`, 409) };
      let note = text(b.note) || null;
      let merged: Item | null = null;
      if (b.merged_into) {
        merged = await one(q, b.merged_into);
        if (!merged || merged.id === item.id) return { error: bad("Pick another item to merge into.") };
        if (to !== "declined") return { error: bad("Merging declines this request in favor of the other item.") };
        note = `Merged into “${merged.title}”.` + (note ? ` ${note}` : "");
      }
      const err = moveError(item, to, { system_url: b.system_url, note });
      if (err) return { error: bad(err, 409) };
      if (item.stage === to) return { item };

      const sets: Record<string, unknown> = { stage: to };
      if (b.system_url) sets.system_url = b.system_url;
      if (to === "declined" || to === "retired") sets.decision_note = note;
      if (merged) sets.merged_into = merged.id;
      if (to === "triage") { sets.decision_note = null; sets.merged_into = null; }
      const keys = Object.keys(sets);
      const extra = ["stage_changed_at = now()", "updated_at = now()"];
      if (to === "live" && !item.live_at) extra.push("live_at = now()");
      await q(`UPDATE items SET ${[...keys.map((k, i) => `${k} = $${i + 2}${k === "stage" ? "::stage" : ""}`), ...extra].join(", ")} WHERE id = $1`, [item.id, ...keys.map((k) => sets[k])]);
      const detail = merged ? `Merged into “${merged.title}”` : item.stage === "triage" && to === "idea" ? "Accepted into Idea" : `${label(item.stage)} → ${label(to)}`;
      await event(q, item.id, actor, item.stage === "triage" ? "triaged" : "moved", detail);
      return { item: await one(q, item.id) };
    });
    return "error" in result ? result.error! : c.json({ item: result.item });
  });

  /* ------------------------------------------------------------ ship log */

  app.post("/api/items/:id/log", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const metric = text(b.metric), unit = text(b.unit), date = text(b.date), value = Number(b.value);
    if (!metric) return bad("Name what was measured.");
    if (b.value === "" || b.value == null || !Number.isFinite(value)) return bad("The value must be a number.");
    if (!unit) return bad("Give the unit, for example meetings, % or hours.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("Use the date it was measured, like 2026-11-05.");
    if (date > new Date().toISOString().slice(0, 10)) return bad("A result cannot be measured in the future.");
    const source = text(b.source_url) || null;
    if (source && !isUrl(source)) return bad("The source must start with http:// or https://.");
    const actor = c.get("actor");
    const db = dbOf(c);
    const result = await db.tx(async (q) => {
      const item = await one(q, c.req.param("id"));
      if (!item) return { error: bad("That item no longer exists.", 404) };
      if (item.stage !== "live") return { error: bad("Results are logged against live items.", 409) };
      const id = newId("sl");
      await q("INSERT INTO ship_log (id, item_id, date, metric, value, unit, note, source_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, item.id, date, metric, value, unit, text(b.note) || null, source]);
      await q("UPDATE items SET updated_at = now() WHERE id = $1", [item.id]);
      await event(q, item.id, actor, "logged", `Logged ${metric}: ${value}${unit === "%" ? "%" : ` ${unit}`}`);
      const [entry] = await q<ShipLogEntry>("SELECT id, item_id, date::text AS date, metric, value, unit, note, source_url, created_at FROM ship_log WHERE id = $1", [id]);
      return { entry };
    });
    return "error" in result ? result.error! : c.json({ entry: result.entry }, 201);
  });

  app.all("/api/*", () => bad("No such endpoint.", 404));
  return app;
}

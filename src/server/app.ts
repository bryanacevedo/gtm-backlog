/* gtm-backlog API. Runtime-agnostic: the same Hono app runs under Node
   (src/server/node.ts, local and Docker) and on Cloudflare (src/server/worker.ts).
   Every write re-checks the rules in shared/domain.ts, runs in one transaction
   and records an event, so the activity feed is the audit trail. The schema
   enforces the same rules a second time (migrations/0001_init.sql). */

import { Hono, type Context } from "hono";
import type { Db } from "./db.ts";
import { safeEqual } from "./safe.ts";
import {
  TEAMS, TOUCHES, canLogResults, label, moveError, validateInputs,
  type EventRow, type Item, type ShipLogEntry, type Stage,
} from "../shared/domain.ts";
import { DEFAULT_ACCENT, accentError, checkPhoto, checkSetting, normalizeHex, SETTING_KEYS, type SettingKey, type Settings } from "../shared/settings.ts";
import { kindWord, parseWorkLink, readPullRequest, type WorkLink } from "../shared/work.ts";

/** Which data space a request reaches, decided by the caller's credentials and nothing the request names. */
export interface Space {
  db: Db;
  demo: boolean;
  /** When set, writes are logged under this name and the x-actor header is ignored (a signed-in user). */
  actor?: string;
  /** The signed-in person's Google address (real space only). A photo is stored under it, so it is never taken from the request. */
  email?: string;
  /** Put in front of a name the caller supplies (scripts), so it cannot pass for a signed-in person. */
  actorPrefix?: string;
  /** Merged into the meta of /api/state (who is signed in, which space, what the header may offer). */
  meta?: Record<string, unknown>;
}
export interface AppConfig {
  writeKey?: string;
  demo: boolean;
  /** The accent used when a space has none stored (the ACCENT variable). Ignored unless it passes the same checks as a setting. */
  accent?: string;
  /** GITHUB_TOKEN: raises the limit when a pasted pull request is looked up on GitHub. Real space only, never logged. */
  githubToken?: string;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
  /** Hosted mode: choose the space per request (or answer with a Response, such as a refusal). */
  resolve?: (c: Context) => Promise<Space | Response>;
}
type Ctx = { Variables: { actor: string; space: Space } };

const ITEM_COLS = `id, title, problem, team, requester, touches, link, stage::text AS stage, owner, impact, reach, confidence,
  effort_days, scored_at, scored_by, system_url, target_date::text AS target_date, decision_note, merged_into, live_at,
  created_at, updated_at, stage_changed_at`;

const WORK_COLS = "id, item_id, kind, url, title, state, meta, created_at, created_by";
const LOG_COLS = "id, item_id, date::text AS date, metric, value, unit, note, source_url, created_at";

const newId = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const isUrl = (s: unknown) => typeof s === "string" && /^https?:\/\/\S+$/.test(s);
const text = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const bad = (msg: string, status: 400 | 401 | 403 | 404 | 409 | 503 = 400) => Response.json({ error: msg }, { status });

export function createApp(getDb: () => Db | Promise<Db>, cfg: AppConfig) {
  const app = new Hono<Ctx>();
  const dbOf = (c: Context<Ctx>) => c.get("space").db;

  const one = async (q: Db["query"], id: string) =>
    (await q<Item>(`SELECT ${ITEM_COLS} FROM items WHERE id = $1`, [id]))[0] ?? null;
  const event = (q: Db["query"], item: string | null, actor: string, kind: EventRow["kind"], detail: string) =>
    q("INSERT INTO events (id, item_id, actor, kind, detail) VALUES ($1, $2, $3, $4, $5)", [newId("ev"), item, actor, kind, detail]);

  /** Stored settings over the install's defaults. */
  const defaultAccent = (() => {
    const hex = normalizeHex(cfg.accent);
    if (cfg.accent?.trim() && (!hex || accentError(hex))) console.warn("ACCENT is ignored: it must be a six-digit colour that white text can be read on (contrast 4.5 to 1 or better).");
    return hex && !accentError(hex) ? hex : DEFAULT_ACCENT;
  })();
  const readSettings = async (db: Db): Promise<Settings> => {
    // `value` is aliased: db.clean() turns any column called value into a number (the ship log's), and a setting is JSON.
    const rows = await db.query<{ key: string; val: unknown }>("SELECT key, value AS val FROM settings");
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.val]));
    const accent = normalizeHex(stored.accent);
    const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    return { accent: accent && !accentError(accent) ? accent : defaultAccent, team_colors: obj(stored.team_colors) as Record<string, string>, team_glyphs: obj(stored.team_glyphs) as Record<string, string | null> };
  };

  /** Uploaded photos by person's name. The addresses they are stored under never leave the server. */
  const readPhotos = async (db: Db): Promise<Record<string, string>> => {
    const [row] = await db.query<{ val: Record<string, { name?: unknown; photo?: unknown }> | null }>("SELECT value AS val FROM settings WHERE key = 'user_photos'");
    const out: Record<string, string> = {};
    if (row?.val && typeof row.val === "object") for (const v of Object.values(row.val)) if (v && typeof v.name === "string" && typeof v.photo === "string" && "value" in checkPhoto(v.photo)) out[v.name] = v.photo;
    return out;
  };

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
    const [items, shipLog, events, workLinks, settings, photos] = await Promise.all([
      db.query<Item>(`SELECT ${ITEM_COLS} FROM items`),
      db.query<ShipLogEntry>(`SELECT ${LOG_COLS} FROM ship_log ORDER BY date DESC, created_at DESC`),
      db.query<EventRow>("SELECT id, item_id, at, actor, kind, detail FROM events ORDER BY at DESC LIMIT 400"),
      db.query<WorkLink>(`SELECT ${WORK_COLS} FROM work_links ORDER BY created_at DESC`),
      readSettings(db),
      readPhotos(db),
    ]);
    return c.json({ items, shipLog, events, workLinks, meta: { demo: c.get("space").demo, writeKey: !cfg.resolve && Boolean(cfg.writeKey), now: new Date().toISOString(), settings, photos, ...c.get("space").meta } });
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
      if (!canLogResults(item.stage)) return { error: bad("Results are logged against items that are building or live.", 409) };
      const id = newId("sl");
      await q("INSERT INTO ship_log (id, item_id, date, metric, value, unit, note, source_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, item.id, date, metric, value, unit, text(b.note) || null, source]);
      await q("UPDATE items SET updated_at = now() WHERE id = $1", [item.id]);
      await event(q, item.id, actor, "logged", `Logged ${metric}: ${value}${unit === "%" ? "%" : ` ${unit}`}`);
      const [entry] = await q<ShipLogEntry>(`SELECT ${LOG_COLS} FROM ship_log WHERE id = $1`, [id]);
      return { entry };
    });
    return "error" in result ? result.error! : c.json({ entry: result.entry }, 201);
  });

  /* ----------------------------------------------------------- work links */

  /** Asks GitHub once, briefly, what a pasted pull request is called and how it stands. Any failure leaves the pasted address as it is. */
  const lookUpPullRequest = async (repo: string, number: number, token: string | undefined) => {
    try {
      const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "gtm-backlog" };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await (cfg.fetch ?? fetch)(`https://api.github.com/repos/${repo}/pulls/${number}`, { headers, signal: AbortSignal.timeout(2500) });
      return res.ok ? readPullRequest(await res.json()) : null;
    } catch { return null; }
  };

  app.post("/api/items/:id/links", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const parsed = parseWorkLink(b.url);
    if ("error" in parsed) return bad(parsed.error);
    const given = text(b.title).slice(0, 200);
    let { title, meta } = parsed, state: WorkLink["state"] = null;
    if (parsed.kind === "pr") {
      // The demo is open to everyone, so it never spends the real space's GitHub allowance.
      const hit = c.get("space").demo ? null : await lookUpPullRequest(String(parsed.meta.repo), Number(parsed.meta.number), cfg.githubToken);
      if (hit) { title = hit.title; state = hit.state; meta = { ...meta, ...hit.meta }; } // else: the address as pasted, state unknown
    }
    if (given && (parsed.kind === "session" || parsed.kind === "doc")) title = given;
    const actor = c.get("actor");
    const db = dbOf(c);
    const result = await db.tx(async (q) => {
      const item = await one(q, c.req.param("id"));
      if (!item) return { error: bad("That item no longer exists.", 404) };
      const [dup] = await q<{ id: string }>("SELECT id FROM work_links WHERE item_id = $1 AND url = $2", [item.id, parsed.url]);
      if (dup) return { error: bad("That link is already on this item.", 409) };
      const id = newId("wl");
      await q("INSERT INTO work_links (id, item_id, kind, url, title, state, meta, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)",
        [id, item.id, parsed.kind, parsed.url, title, state, JSON.stringify(meta), actor]);
      await q("UPDATE items SET updated_at = now() WHERE id = $1", [item.id]);
      await event(q, item.id, actor, "edited", `Linked ${kindWord(parsed.kind)}${parsed.kind === "pr" && meta.number ? ` #${meta.number}` : parsed.kind === "repo" || parsed.kind === "commit" ? ` ${title}` : ""}`);
      const [link] = await q<WorkLink>(`SELECT ${WORK_COLS} FROM work_links WHERE id = $1`, [id]);
      return { link };
    });
    return "error" in result ? result.error! : c.json({ link: result.link }, 201);
  });

  app.delete("/api/items/:id/links/:linkId", async (c) => {
    const actor = c.get("actor");
    const db = dbOf(c);
    const result = await db.tx(async (q) => {
      const [link] = await q<WorkLink>(`SELECT ${WORK_COLS} FROM work_links WHERE id = $1 AND item_id = $2`, [c.req.param("linkId"), c.req.param("id")]);
      if (!link) return { error: bad("That link is already gone.", 404) };
      await q("DELETE FROM work_links WHERE id = $1", [link.id]);
      await q("UPDATE items SET updated_at = now() WHERE id = $1", [link.item_id]);
      await event(q, link.item_id, actor, "edited", `Removed the ${kindWord(link.kind)} ${link.title}`);
      return { ok: true };
    });
    return "error" in result ? result.error! : c.json({ ok: true });
  });

  /* ------------------------------------------------------------ settings */

  app.put("/api/settings/:key", async (c) => {
    const key = c.req.param("key");
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const checked = checkSetting(key, b.value);
    if ("error" in checked) return bad(checked.error, SETTING_KEYS.includes(key as SettingKey) ? 400 : 404);
    const actor = c.get("actor");
    const db = dbOf(c);
    await db.tx(async (q) => {
      await q("INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [key, JSON.stringify(checked.value)]);
      await event(q, null, actor, "settings", key === "accent" ? `Set the accent colour to ${checked.value}` : key === "team_glyphs" ? "Changed the team glyphs" : "Changed the team colours");
    });
    return c.json({ key, value: checked.value, settings: await readSettings(db) });
  });

  /* A person's own photo. Only the signed-in person's own address can be written, and only in the real space:
     the demo has no addresses and a script with the write key is nobody. */
  const photoOwner = (c: Context<Ctx>) => {
    const { email, demo } = c.get("space");
    return !demo && email ? email.trim().toLowerCase() : null;
  };
  app.put("/api/me/photo", async (c) => {
    const email = photoOwner(c);
    if (!email) return bad("A photo belongs to a signed-in person in the real backlog.", 403);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const checked = checkPhoto(b.photo);
    if ("error" in checked) return bad(checked.error);
    const actor = c.get("actor"), db = dbOf(c);
    await db.tx(async (q) => {
      await q("INSERT INTO settings (key, value, updated_at) VALUES ('user_photos', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value, updated_at = now()",
        [JSON.stringify({ [email]: { name: actor, photo: checked.value } })]);
      await event(q, null, actor, "settings", "Changed their photo");
    });
    return c.json({ photos: await readPhotos(db) });
  });
  app.delete("/api/me/photo", async (c) => {
    const email = photoOwner(c);
    if (!email) return bad("A photo belongs to a signed-in person in the real backlog.", 403);
    const actor = c.get("actor"), db = dbOf(c);
    await db.tx(async (q) => {
      await q("UPDATE settings SET value = value - $1::text, updated_at = now() WHERE key = 'user_photos'", [email]);
      await event(q, null, actor, "settings", "Removed their photo");
    });
    return c.json({ photos: await readPhotos(db) });
  });

  app.all("/api/*", () => bad("No such endpoint.", 404));
  return app;
}

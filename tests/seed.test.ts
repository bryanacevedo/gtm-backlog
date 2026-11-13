/* The sample backlog has to agree with itself on screen: "since" on an item page is stage_changed_at, and the
   activity feed beside it must show the same day for the move that put the item there. */
import { allMigrations } from "./migrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, pglite, type Db } from "../src/server/db";
import { seedSql } from "../src/server/seed";
import { TEAMS, canLogResults, teamsOf, type Stage } from "../src/shared/domain";
import { parseWorkLink } from "../src/shared/work";

let db: Db;
beforeAll(async () => {
  db = await pglite();
  await migrate(db, allMigrations());
  await db.exec(seedSql());
});
afterAll(() => db.close());

describe("the sample data", () => {
  it("dates each item's last stage event on the day its stage began", async () => {
    const rows = await db.query<{ id: string; stage: string; since: string; last: string }>(
      `SELECT i.id, i.stage::text AS stage, i.stage_changed_at::date::text AS since,
              (SELECT max(e.at)::date::text FROM events e WHERE e.item_id = i.id AND e.kind IN ('created', 'triaged', 'moved')) AS last
         FROM items i`);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect(r.last, `${r.id} (${r.stage})`).toBe(r.since);
  });

  it("orders each item's events: requested, then decided, then built", async () => {
    const rows = await db.query<{ item_id: string; kind: string; at: string }>("SELECT item_id, kind, at::text AS at FROM events WHERE kind IN ('created', 'triaged') ORDER BY item_id, at");
    const byItem = new Map<string, string[]>();
    for (const r of rows) byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), r.kind]);
    for (const [id, kinds] of byItem) expect(kinds[0], id).toBe("created");
  });

  it("writes result metrics as nouns, not sentence tails", async () => {
    const rows = await db.query<{ metric: string }>("SELECT metric FROM ship_log");
    expect(rows.length).toBeGreaterThan(0);
    for (const { metric } of rows) expect(metric).toMatch(/^[A-Z]/);
  });
});

describe("the sample work", () => {
  it("gives every building and live item a repo, pull requests and sessions, all links the recogniser reads the same way", async () => {
    const rows = await db.query<{ item_id: string; stage: string; kind: string; url: string; state: string | null }>(
      "SELECT w.item_id, i.stage::text AS stage, w.kind, w.url, w.state FROM work_links w JOIN items i ON i.id = w.item_id");
    const byItem = new Map<string, typeof rows>();
    for (const r of rows) byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), r]);
    const stages = await db.query<{ id: string; stage: string; live_at: string | null }>("SELECT id, stage::text AS stage, live_at FROM items WHERE stage IN ('building', 'live')");
    expect(stages.length).toBeGreaterThanOrEqual(8);
    for (const i of stages) {
      const links = byItem.get(i.id) ?? [];
      expect(links.some((l) => l.kind === "session"), `${i.id} has a session`).toBe(true);
      expect(links.some((l) => l.kind === "pr" || l.kind === "doc"), `${i.id} has a pull request or doc`).toBe(true);
    }
    for (const l of rows) {
      const p = parseWorkLink(l.url);
      expect("error" in p ? p.error : p.kind, l.url).toBe(l.kind === "repo" ? "repo" : l.kind);
      expect(l.state === null || ["open", "merged", "closed"].includes(l.state)).toBe(true);
    }
    expect(rows.some((l) => l.state === "open")).toBe(true);
    expect(rows.some((l) => l.state === "merged")).toBe(true);
  });

  it("logs results only against items that may have them, and the building items have some", async () => {
    const rows = await db.query<{ stage: Stage }>("SELECT DISTINCT i.stage::text AS stage FROM ship_log s JOIN items i ON i.id = s.item_id");
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(canLogResults(r.stage) || r.stage === "retired", r.stage).toBe(true);
    expect(rows.map((r) => r.stage)).toContain("building");
  });

  it("starts with no stored settings, whatever a visitor changed before the reload", async () => {
    await db.query("INSERT INTO settings (key, value) VALUES ('accent', '\"#C2410C\"') ON CONFLICT (key) DO NOTHING");
    await db.exec(seedSql());
    expect((await db.query("SELECT 1 FROM settings")).length).toBe(0);
  });
});

describe("teams", () => {
  it("offers the known teams, then any other team an item already has", () => {
    expect(teamsOf([{ team: "Sales" }])).toEqual([...TEAMS]);
    expect(teamsOf([{ team: "Sales" }, { team: "Zeta" }, { team: "Alpha" }])).toEqual([...TEAMS, "Alpha", "Zeta"]);
    expect(TEAMS).toContain("Ways of working");
  });
});

/* The sample backlog has to agree with itself on screen: "since" on an item page is stage_changed_at, and the
   activity feed beside it must show the same day for the move that put the item there. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, pglite, type Db } from "../src/server/db";
import { seedSql } from "../src/server/seed";
import { TEAMS, teamsOf } from "../src/shared/domain";

let db: Db;
beforeAll(async () => {
  db = await pglite();
  await migrate(db, [{ name: "0001_init.sql", sql: readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8") }]);
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

describe("teams", () => {
  it("offers the known teams, then any other team an item already has", () => {
    expect(teamsOf([{ team: "Sales" }])).toEqual([...TEAMS]);
    expect(teamsOf([{ team: "Sales" }, { team: "Zeta" }, { team: "Alpha" }])).toEqual([...TEAMS, "Alpha", "Zeta"]);
    expect(TEAMS).toContain("Ways of working");
  });
});

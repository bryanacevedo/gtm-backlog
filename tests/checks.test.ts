/* Checks on cards (bl_155): a verdict in an item's history, shown as the card's latest check. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allMigrations } from "./migrations";
import { createApp } from "../src/server/app";
import { migrate, pglite, type Db } from "../src/server/db";
import { seedSql } from "../src/server/seed";
import { CHECK_SQL, latestChecks, parseCheck } from "../src/shared/checks";
import type { EventRow } from "../src/shared/domain";

const ev = (id: string, item: string | null, at: string, detail: string, kind: EventRow["kind"] = "logged"): EventRow => ({ id, item_id: item, at, actor: "a", kind, detail });

describe("parseCheck", () => {
  it("reads '<Check>: pass' and '<Check>: fail' in logged events", () => {
    expect(parseCheck(ev("1", "x", "t", "Goldfish: pass, 2026-11-18"))).toMatchObject({ name: "Goldfish", verdict: "pass" });
    expect(parseCheck(ev("1", "x", "t", "Code review: FAILED. Two findings."))).toMatchObject({ name: "Code review", verdict: "fail" });
    expect(parseCheck(ev("1", "x", "t", "Smoke test: blocked"))).toMatchObject({ verdict: "fail" });
    expect(parseCheck(ev("1", "x", "t", "Smoke test:pass"))).toMatchObject({ verdict: "pass" });
    expect(parseCheck(ev("1", "x", "t", "Goldfish: pass; Live note matches RESULTS"))).toMatchObject({ verdict: "pass" });
  });
  it("ignores everything else", () => {
    for (const d of ["Logged Replies sorted: 200 replies", "Live: passed to the team", "Goldfish: passive review", "Idea → Building", "Review pass", ": pass", "A very long name that is far past thirty-one characters: pass"])
      expect(parseCheck(ev("1", "x", "t", d)), d).toBeNull();
    expect(parseCheck(ev("1", "x", "t", "Goldfish: pass", "moved"))).toBeNull();
  });
});

describe("latestChecks", () => {
  it("keeps each item's newest check, whatever order the events come in", () => {
    const m = latestChecks([
      ev("1", "a", "2026-11-17T10:00:00Z", "Review: fail"),
      ev("2", "a", "2026-11-18T10:00:00Z", "Review: pass"),
      ev("3", "b", "2026-11-18T09:00:00Z", "Goldfish: fail"),
      ev("4", null, "2026-11-18T11:00:00Z", "Review: pass"),
      ev("5", "b", "2026-11-18T12:00:00Z", "Logged x: 3 calls"),
    ]);
    expect(m.get("a")).toMatchObject({ verdict: "pass", at: "2026-11-18T10:00:00Z" });
    expect(m.get("b")).toMatchObject({ name: "Goldfish", verdict: "fail" });
    expect(m.size).toBe(2);
  });
});

describe("/api/state", () => {
  let db: Db;
  beforeAll(async () => { db = await pglite(); await migrate(db, allMigrations()); await db.exec(seedSql()); });
  afterAll(() => db.close());

  it("matches in Postgres exactly what the app matches", async () => {
    const cases = ["Goldfish: pass, 2026-11-18", "Code review: FAILED. Two findings.", "Smoke test: blocked", "Smoke test:pass", "Goldfish: pass; Live note matches RESULTS",
      "Logged Replies sorted: 200 replies", "Live: passed to the team", "Goldfish: passive review", "Idea → Building", "Review pass", ": pass", "A very long name that is far past thirty-one characters: pass"];
    for (const d of cases) {
      const [{ m }] = await db.query<{ m: boolean }>("SELECT $1 ~* $2 AS m", [d, CHECK_SQL]);
      expect(m, d).toBe(parseCheck(ev("1", "x", "t", d)) !== null);
    }
  });

  it("sends every item's latest check even when it is older than the latest 400 events", async () => {
    await db.query("INSERT INTO events (id, item_id, at, actor, kind, detail) VALUES ('ev_old', 'bl_005', now() - interval '400 days', 'a', 'logged', 'Data check: pass. Old.')");
    await db.query("INSERT INTO events (id, item_id, at, actor, kind, detail) SELECT 'ev_f' || g, 'bl_001', now() - interval '1 minute' * g, 'a', 'edited', 'Edited' FROM generate_series(1, 450) g");
    const app = createApp(() => db, { demo: true });
    const body = await (await app.fetch(new Request("http://x/api/state"))).json() as { events: EventRow[] };
    expect(body.events.some((e) => e.id === "ev_old")).toBe(true);
    expect(body.events.filter((e) => e.kind === "edited").length).toBeLessThanOrEqual(400);
    const ats = body.events.map((e) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    const checks = latestChecks(body.events);
    expect(checks.get("bl_005")).toMatchObject({ name: "Data check", verdict: "pass" });
    // The sample's own checks: the merge job's newest review passed after an earlier failure.
    expect(checks.get("bl_001")).toMatchObject({ name: "Code review", verdict: "pass" });
  });
});

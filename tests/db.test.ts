/* The schema against real Postgres (PGlite): the database's generated score must
   equal the shared score() the app ranks by, and the CHECK constraints must hold
   even when the API is bypassed. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, pglite, type Db } from "../src/server/db";
import { score } from "../src/shared/domain";

let db: Db;
beforeAll(async () => {
  db = await pglite();
  await migrate(db, [{ name: "0001_init.sql", sql: readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8") }]);
});
afterAll(() => db.close());

const insert = (id: string, extra: Record<string, unknown> = {}) => {
  const cols = { id, title: "t", problem: "p", team: "Sales", requester: "r", ...extra };
  const keys = Object.keys(cols);
  return db.query(`INSERT INTO items (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(cols));
};

describe("schema", () => {
  it("computes the same score as the app, for every combination tried", async () => {
    const cases = [[1, 0, 50, 0.5], [3, 140, 80, 6], [5, 400, 100, 9], [4, 12, 80, 3], [2, 7, 50, 2.5]];
    for (const [i, [impact, reach, confidence, effort_days]] of cases.entries()) {
      await insert(`s${i}`, { impact, reach, confidence, effort_days });
      const [row] = await db.query<{ score: number }>("SELECT score FROM items WHERE id = $1", [`s${i}`]);
      expect(row.score).toBeCloseTo(score({ impact, reach, confidence, effort_days })!, 9);
    }
  });

  it("leaves the score empty when an input is missing", async () => {
    await insert("u1", { impact: 3, reach: 10 });
    const [row] = await db.query<{ score: number | null }>("SELECT score FROM items WHERE id = 'u1'");
    expect(row.score).toBeNull();
  });

  it("refuses a live item with no system link", async () => {
    await expect(insert("l1", { stage: "live" })).rejects.toThrow(/live_needs_system/);
  });

  it("refuses a declined or retired item with no reason", async () => {
    await expect(insert("d1", { stage: "declined" })).rejects.toThrow(/closed_needs_reason/);
    await expect(insert("r1", { stage: "retired", system_url: "https://x" })).rejects.toThrow(/closed_needs_reason/);
  });

  it("refuses out-of-range inputs", async () => {
    await expect(insert("x1", { impact: 7 })).rejects.toThrow();
    await expect(insert("x2", { confidence: 60 })).rejects.toThrow();
    await expect(insert("x3", { effort_days: 0 })).rejects.toThrow();
  });
});

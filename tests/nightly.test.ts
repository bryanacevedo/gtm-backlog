import { describe, expect, it } from "vitest";
import { keepAlive, lastNightly, nextNightly, sampleIsStale } from "../src/server/nightly.ts";

const at = (s: string) => Date.parse(s);

describe("nightly schedule", () => {
  it("picks the next 06:00 UTC", () => {
    expect(nextNightly(at("2026-11-12T05:59:00Z"))).toBe(at("2026-11-12T06:00:00Z"));
    expect(nextNightly(at("2026-11-12T06:00:00Z"))).toBe(at("2026-11-13T06:00:00Z"));
    expect(nextNightly(at("2026-11-12T20:00:00Z"))).toBe(at("2026-11-13T06:00:00Z"));
  });
  it("finds the last mark", () => {
    expect(lastNightly(at("2026-11-12T05:00:00Z"))).toBe(at("2026-11-11T06:00:00Z"));
    expect(lastNightly(at("2026-11-12T07:00:00Z"))).toBe(at("2026-11-12T06:00:00Z"));
  });
  it("treats a sample from a day before the last mark as missed", () => {
    // seeded on the 11th, freshest request created the 10th at 09:00
    const created = at("2026-11-10T09:00:00Z");
    expect(sampleIsStale(created, at("2026-11-11T12:00:00Z"))).toBe(false);
    expect(sampleIsStale(created, at("2026-11-12T07:00:00Z"))).toBe(true);
    expect(sampleIsStale(null, at("2026-11-12T07:00:00Z"))).toBe(true);
  });
});

describe("keep-alive", () => {
  it("does nothing without a real database", async () => {
    const lines: string[] = [];
    expect(await keepAlive(null, (l) => lines.push(l))).toBeNull();
    expect(lines).toEqual([]);
  });
  it("runs one read-only query and logs one line", async () => {
    const queries: string[] = [];
    const lines: string[] = [];
    const db = { query: async (t: string) => { queries.push(t); return [{ ok: 1 }]; } };
    await keepAlive(async () => db, (l) => lines.push(l));
    expect(queries).toEqual(["SELECT 1 AS ok"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/answered/);
  });
  it("logs and carries on when the database is down, without leaking details", async () => {
    const lines: string[] = [];
    const secret = "postgresql://user:hunter2@db.example.supabase.co:5432/postgres";
    const down = async () => { throw new Error(`connect ECONNREFUSED ${secret}`); };
    await expect(keepAlive(down, (l) => lines.push(l))).resolves.toMatch(/did not answer/);
    const failQuery = { query: async () => { throw new Error(secret); } };
    await expect(keepAlive(async () => failQuery, (l) => lines.push(l))).resolves.toMatch(/did not answer/);
    expect(lines.join("\n")).not.toMatch(/hunter2|supabase|postgresql/);
  });
});

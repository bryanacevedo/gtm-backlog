import { describe, expect, it } from "vitest";
import { lastNightly, nextNightly, sampleIsStale } from "../src/server/nightly.ts";

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

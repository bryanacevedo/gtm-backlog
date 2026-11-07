import { describe, expect, it } from "vitest";
import { score, rank, moveError, isSilent, validateInputs, type Item } from "../src/shared/domain";

const base: Item = {
  id: "a", title: "t", problem: "p", team: "Sales", requester: "r", touches: [], link: null,
  stage: "idea", owner: null, impact: 3, reach: 100, confidence: 80, effort_days: 4, scored_at: null, scored_by: null,
  system_url: null, target_date: null, decision_note: null, merged_into: null, live_at: null,
  created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", stage_changed_at: "2026-11-01T10:00:00Z",
};

describe("score", () => {
  it("is impact x reach x confidence / effort", () => {
    expect(score(base)).toBeCloseTo((3 * 100 * 0.8) / 4);
  });
  it("is null when any input is missing", () => {
    expect(score({ ...base, reach: null })).toBeNull();
    expect(score({ ...base, effort_days: null })).toBeNull();
  });
  it("is null for zero effort rather than infinite", () => {
    expect(score({ ...base, effort_days: 0 })).toBeNull();
  });
});

describe("rank", () => {
  it("puts scored items first by score, then unscored oldest first", () => {
    const items: Item[] = [
      { ...base, id: "low", impact: 1 },
      { ...base, id: "unscored-new", impact: null, created_at: "2026-11-05T00:00:00Z" },
      { ...base, id: "high", impact: 5 },
      { ...base, id: "unscored-old", impact: null, created_at: "2026-10-01T00:00:00Z" },
    ];
    expect(rank(items).map((i) => i.id)).toEqual(["high", "low", "unscored-old", "unscored-new"]);
  });
});

describe("moveError", () => {
  it("allows the normal flow", () => {
    expect(moveError({ stage: "idea", system_url: null }, "building")).toBeNull();
  });
  it("refuses skipping from idea straight to live", () => {
    expect(moveError({ stage: "idea", system_url: "https://x" }, "live")).toMatch(/cannot move/);
  });
  it("requires a system link to go live", () => {
    expect(moveError({ stage: "building", system_url: null }, "live")).toMatch(/link/);
    expect(moveError({ stage: "building", system_url: null }, "live", { system_url: "https://x" })).toBeNull();
  });
  it("requires a reason to decline or retire", () => {
    expect(moveError({ stage: "triage", system_url: null }, "declined")).toMatch(/why/);
    expect(moveError({ stage: "triage", system_url: null }, "declined", { note: "Duplicate of routing" })).toBeNull();
  });
});

describe("isSilent", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  it("flags a live item with no result in 30 days", () => {
    expect(isSilent({ stage: "live", live_at: null, stage_changed_at: "2026-09-01T00:00:00Z" }, [{ date: "2026-09-20" }], now)).toBe(true);
  });
  it("does not flag a recently logged item", () => {
    expect(isSilent({ stage: "live", live_at: null, stage_changed_at: "2026-09-01T00:00:00Z" }, [{ date: "2026-11-01" }], now)).toBe(false);
  });
  it("gives a newly shipped item 30 days before it counts as silent", () => {
    expect(isSilent({ stage: "live", live_at: null, stage_changed_at: "2026-10-20T00:00:00Z" }, [], now)).toBe(false);
  });
  it("never flags items that are not live", () => {
    expect(isSilent({ stage: "building", live_at: null, stage_changed_at: "2026-01-01T00:00:00Z" }, [], now)).toBe(false);
  });
});

describe("validateInputs", () => {
  it("rejects out-of-range values with a sentence a person can act on", () => {
    expect(validateInputs({ impact: 7 })).toMatch(/1 to 5/);
    expect(validateInputs({ confidence: 60 })).toMatch(/50, 80 or 100/);
    expect(validateInputs({ effort_days: 0 })).toMatch(/above 0/);
    expect(validateInputs({ impact: 4, confidence: 80 })).toBeNull();
  });
});

/* The Board's rules with no DOM: column order, where a dropped card lands, the head figures, the stage an arrow means, the pull requests. */
import { describe, expect, it } from "vitest";
import { columnSums, columnsOf, movedTo, nearestStage, pullRequests, slotIndex, sortStage, stageStep } from "../src/app/board-logic";
import { planMove } from "../src/app/forms";
import type { Item, ShipLogEntry, Stage } from "../src/shared/domain";

const NOW = new Date("2026-11-13T12:00:00Z");
let n = 0;
const item = (o: Partial<Item> & { stage: Stage }): Item => ({
  id: `i${++n}`, title: "T", problem: "", team: "Sales", requester: "R", touches: [], link: null, owner: null,
  impact: 3, reach: 100, confidence: 100, effort_days: 10, scored_at: null, scored_by: null, system_url: null, target_date: null, decision_note: null, merged_into: null,
  live_at: null, created_at: `2026-10-${String(10 + (n % 15)).padStart(2, "0")}T00:00:00Z`, updated_at: "2026-11-01T00:00:00Z", stage_changed_at: "2026-11-10T00:00:00Z", ...o,
});
const scored = (stage: Stage, effort: number, o: Partial<Item> = {}) => item({ stage, effort_days: effort, ...o }); // score 30 / effort * 10: effort 10 = 30, 5 = 60, 20 = 15
const unscored = (stage: Stage) => item({ stage, confidence: null });
const log = (item_id: string, date: string): ShipLogEntry => ({ id: `l${++n}`, item_id, date, metric: "m", value: 1, unit: "x", note: null, source_url: null, created_at: date });

describe("column order", () => {
  it("ranks Idea and Building by score, unscored last, and Live newest first", () => {
    const a = scored("idea", 10), b = scored("idea", 5), c = unscored("idea"), d = scored("idea", 20);
    expect(sortStage("idea", [a, c, d, b]).map((i) => i.id)).toEqual([b.id, a.id, d.id, c.id]);
    const l1 = item({ stage: "live", live_at: "2026-09-01T00:00:00Z" }), l2 = item({ stage: "live", live_at: "2026-11-01T00:00:00Z" });
    expect(sortStage("live", [l1, l2]).map((i) => i.id)).toEqual([l2.id, l1.id]);
  });
  it("keeps only the three stages of the flow, and applies a team filter", () => {
    const keep = item({ stage: "idea", team: "SDR" }), other = item({ stage: "building" }), skip = item({ stage: "triage" }), gone = item({ stage: "retired" });
    const cols = columnsOf([keep, other, skip, gone], null);
    expect(cols.idea).toEqual([keep]); expect(cols.building).toEqual([other]); expect(cols.live).toEqual([]);
    expect(columnsOf([keep, other], "SDR").building).toEqual([]);
  });
});

describe("where a dragged card will land", () => {
  const col = [scored("building", 5), scored("building", 10), scored("building", 20)]; // 60, 30, 15
  it("is the place its rank gives it, not the place under the pointer", () => {
    expect(slotIndex("building", col, scored("idea", 4), NOW.toISOString())).toBe(0);
    expect(slotIndex("building", col, scored("idea", 8), NOW.toISOString())).toBe(1);
    expect(slotIndex("building", col, scored("idea", 12), NOW.toISOString())).toBe(2);
    expect(slotIndex("building", col, scored("idea", 100), NOW.toISOString())).toBe(3);
  });
  it("puts an unscored card last", () => { expect(slotIndex("building", col, unscored("idea"), NOW.toISOString())).toBe(3); });
  it("leaves a card where it is when it is dropped back in its own column", () => {
    const mine = col[1];
    expect(slotIndex("building", col, mine, NOW.toISOString())).toBe(1);
  });
  it("puts a card newly live first, and a card that was live before in its old place by the day it first went live", () => {
    const live = [item({ stage: "live", live_at: "2026-11-05T00:00:00Z" }), item({ stage: "live", live_at: "2026-10-01T00:00:00Z" })];
    expect(slotIndex("live", live, item({ stage: "building" }), NOW.toISOString())).toBe(0);
    expect(slotIndex("live", live, item({ stage: "building", live_at: "2026-10-20T00:00:00Z" }), NOW.toISOString())).toBe(1);
  });
  it("moves an item to its new stage with the day it changed", () => {
    const m = movedTo(item({ stage: "idea" }), "live", NOW.toISOString());
    expect(m).toMatchObject({ stage: "live", stage_changed_at: NOW.toISOString(), live_at: NOW.toISOString() });
  });
});

describe("the pointer and the keys", () => {
  const centres = [{ stage: "idea" as Stage, centre: 200 }, { stage: "building" as Stage, centre: 700 }, { stage: "live" as Stage, centre: 1200 }];
  it("picks the column whose centre is nearest across, whatever the height", () => {
    expect(nearestStage(10, centres, "idea")).toBe("idea");
    expect(nearestStage(500, centres, "idea")).toBe("building");
    expect(nearestStage(1000, centres, "idea")).toBe("live");
    expect(nearestStage(5000, centres, "idea")).toBe("live");
    expect(nearestStage(50, [], "building")).toBe("building");
  });
  it("steps one stage left or right and stops at the edges", () => {
    expect(stageStep("idea", 1)).toBe("building"); expect(stageStep("building", 1)).toBe("live"); expect(stageStep("live", 1)).toBeNull();
    expect(stageStep("live", -1)).toBe("building"); expect(stageStep("idea", -1)).toBeNull(); expect(stageStep("declined", 1)).toBeNull();
  });
  it("sends a move to Live through the link dialog, and nothing else", () => {
    const b = item({ stage: "building" });
    expect(planMove(b, "live")).toMatchObject({ mode: "link", to: "live" });
    expect(planMove({ ...b, system_url: "https://x.example" }, "live")).toBeNull();
    expect(planMove(b, "idea")).toBeNull();
    expect(planMove(item({ stage: "idea" }), "building")).toBeNull();
  });
});

describe("what the work links say", () => {
  const links = [
    { item_id: "a", kind: "pr" as const, state: "open" as const }, { item_id: "a", kind: "pr" as const, state: "open" as const },
    { item_id: "a", kind: "pr" as const, state: "merged" as const }, { item_id: "a", kind: "pr" as const, state: "closed" as const },
    { item_id: "a", kind: "repo" as const, state: null }, { item_id: "b", kind: "pr" as const, state: "merged" as const },
  ];
  it("counts open and merged pull requests of one item, and every pull request as the total", () => {
    expect(pullRequests(links, "a")).toEqual({ open: 2, merged: 1, total: 4 });
    expect(pullRequests(links, "b")).toEqual({ open: 0, merged: 1, total: 1 });
  });
  it("finds nothing for a build with no pull requests, so the card shows nothing", () => {
    expect(pullRequests(links, "c")).toEqual({ open: 0, merged: 0, total: 0 });
    expect(pullRequests([{ item_id: "c", kind: "repo", state: null }], "c").total).toBe(0);
  });
});

describe("the column heads", () => {
  it("adds up the score and the unscored in Idea, and says nothing for an empty column", () => {
    expect(columnSums("idea", [scored("idea", 10), scored("idea", 5), unscored("idea")], [], [], NOW)).toEqual({ score: 90, unscored: 1 });
    expect(columnSums("idea", [scored("idea", 10)], [], [], NOW)).toEqual({ score: 30 });
    expect(columnSums("idea", [], [], [], NOW)).toEqual({});
  });
  it("adds open pull requests in Building only when some build has pull requests", () => {
    const a = scored("building", 10), b = scored("building", 10);
    expect(columnSums("building", [a, b], [], [], NOW)).toEqual({ score: 60 });
    expect(columnSums("building", [a, b], [{ item_id: a.id, kind: "pr", state: "open" }, { item_id: a.id, kind: "pr", state: "merged" }], [], NOW)).toEqual({ score: 60, openPrs: 1 });
    expect(columnSums("building", [a], [{ item_id: a.id, kind: "pr", state: "merged" }], [], NOW)).toEqual({ score: 30, openPrs: 0 });
  });
  it("counts measured and silent in Live", () => {
    const fresh = item({ stage: "live", live_at: "2026-11-01T00:00:00Z" }), quiet = item({ stage: "live", live_at: "2026-08-01T00:00:00Z" }), measured = item({ stage: "live", live_at: "2026-08-01T00:00:00Z" });
    const entries = [log(fresh.id, "2026-11-05"), log(measured.id, "2026-11-01")];
    expect(columnSums("live", [fresh, quiet, measured], [], entries, NOW)).toEqual({ measured: 2, silent: 1 });
    expect(columnSums("live", [fresh], [], [], NOW)).toEqual({ measured: 0 });
  });
});

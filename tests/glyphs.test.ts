/* The team glyphs: the closed set, the default by name, one team per glyph, the letters only when there is no glyph. */
import { describe, expect, it } from "vitest";
import { GLYPHS, GLYPH_IDS, checkTeamGlyphs, glyphById, monogram, resolveTeamGlyphs } from "../src/shared/glyphs";
import { TEAMS, teamsOf } from "../src/shared/domain";

describe("the glyph set", () => {
  it("is sixteen distinct glyphs, each one path, and the general one matches no name", () => {
    expect(GLYPHS).toHaveLength(16);
    expect(new Set(GLYPH_IDS).size).toBe(16);
    for (const g of GLYPHS) expect(g.d, g.id).toMatch(/^M[\dMmLlHhVvCcAaZz.,\s-]+$/);
    expect(glyphById("diamond")!.match).toEqual([]);
    expect(glyphById("nope")).toBeUndefined();
  });
});

describe("the default glyph by name", () => {
  const g = (names: string[], stored: Record<string, string | null> = {}) => resolveTeamGlyphs(stored, names).glyph;
  it("gives the nine teams the app ships with their function's glyph", () => {
    expect(g([...TEAMS])).toEqual({
      Sales: "pipeline", SDR: "outbound", Marketing: "broadcast", "Field Marketing": "flag", "Demand Gen": "magnet",
      RevOps: "merge", Partnerships: "rings", "Customer Success": "renew", "Ways of working": "steps",
    });
  });
  it("puts the specific before the general", () => {
    const r = g(["Field Marketing", "Sales Ops", "Sales Enablement", "Sales Leadership", "Customer Support", "Marketing"]);
    expect(r).toMatchObject({ "Field Marketing": "flag", "Sales Ops": "merge", "Sales Enablement": "steps", "Sales Leadership": "rank", "Customer Support": "bubble", Marketing: "broadcast" });
  });
  it("hands a glyph to one team only: the second team that matches it has the letters", () => {
    expect(g(["Marketing", "Brand Marketing"])).toEqual({ Marketing: "broadcast", "Brand Marketing": null });
  });
  it("gives the letters to a team no glyph matches", () => {
    expect(g(["Legal"])).toEqual({ Legal: null });
    expect(monogram("Legal")).toBe("LE");
    expect(monogram("CRM Desk")).toBe("CD");
    expect(monogram("RevOps")).toBe("RO");
    expect(monogram("Ways of working")).toBe("WO");
  });
  it("matches names in any case", () => { expect(g(["SDR", "sdr team"])).toMatchObject({ SDR: "outbound" }); });
  it("keeps a stored pick over the default, and a glyph a stored pick holds is not the default of another team", () => {
    const r = resolveTeamGlyphs({ SDR: "pipeline" }, ["Sales", "SDR"]);
    expect(r.glyph).toEqual({ SDR: "pipeline", Sales: null });
    expect(r.holder.pipeline).toBe("SDR");
    expect(r.free).not.toContain("pipeline");
  });
  it("keeps a stored null as the letters, never the default", () => {
    expect(g([...TEAMS], { Sales: null }).Sales).toBeNull();
  });
  it("ignores a stored glyph outside the set, or one a team earlier in the order already holds", () => {
    expect(g(["Sales", "SDR"], { Sales: "smiley" })).toEqual({ Sales: "pipeline", SDR: "outbound" });
    expect(g(["Sales", "SDR"], { Sales: "bolt", SDR: "bolt" })).toEqual({ Sales: "bolt", SDR: "outbound" });
  });
  it("lists the glyphs nobody holds, so a picker can offer them", () => {
    const r = resolveTeamGlyphs(null, teamsOf([]));
    expect(r.free).toEqual(expect.arrayContaining(["diamond", "bubble", "bars"]));
    expect(r.free).toHaveLength(16 - 9);
  });
});

describe("checking a whole team_glyphs value", () => {
  it("accepts ids from the set and null, one team per glyph", () => {
    expect(checkTeamGlyphs({ Sales: "pipeline", SDR: null, RevOps: "merge" })).toEqual({ value: { Sales: "pipeline", SDR: null, RevOps: "merge" } });
    expect(checkTeamGlyphs({ A: null, B: null })).toHaveProperty("value");
  });
  it("refuses a glyph that is not in the set, a number, a glyph shared by two teams and a value that is not a map", () => {
    expect(checkTeamGlyphs({ Sales: "smiley" })).toMatchObject({ error: expect.stringContaining("glyphs offered") });
    expect(checkTeamGlyphs({ Sales: 4 })).toHaveProperty("error");
    expect(checkTeamGlyphs({ Sales: "bolt", SDR: "bolt" })).toMatchObject({ error: expect.stringContaining("cannot share") });
    for (const bad of [[], null, "bolt", 3]) expect(checkTeamGlyphs(bad)).toHaveProperty("error");
    expect(checkTeamGlyphs({ "": "bolt" })).toHaveProperty("error");
    expect(checkTeamGlyphs({ ["x".repeat(61)]: "bolt" })).toHaveProperty("error");
  });
});

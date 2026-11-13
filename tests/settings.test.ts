/* The accent and the team colours: what is accepted, what is refused and why, and that a write reaches /api/state. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { migrate, pglite, type Db } from "../src/server/db";
import {
  ACCENT_SWATCHES, DEFAULT_ACCENT, DEFAULT_TEAM_COLORS, PALETTE_HEX, accentError, accentHover, checkTeamColors, contrastWithWhite, normalizeHex, resolveTeamColors,
} from "../src/shared/settings";
import { TEAMS, teamsOf } from "../src/shared/domain";
import { allMigrations } from "./migrations";

describe("accent contrast", () => {
  it("measures white on black as 21 to 1 and white on white as 1 to 1", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastWithWhite("#FFFFFF")).toBeCloseTo(1, 5);
  });
  it("accepts every curated swatch, including the default ink, for white text", () => {
    expect(ACCENT_SWATCHES.map((s) => s.name)).toEqual(["Ink", "Blue", "Teal", "Green", "Violet", "Plum", "Red", "Deep orange"]);
    for (const s of ACCENT_SWATCHES) expect(accentError(s.hex), s.name).toBeNull();
    expect(ACCENT_SWATCHES[0].hex).toBe(DEFAULT_ACCENT);
  });
  it("refuses a colour too light for white text, and says so", () => {
    expect(accentError("#FFC107")).toMatch(/^Too light for white text/);
    expect(accentError("#9CA3AF")).toMatch(/^Too light for white text/);
  });
  it("sits exactly on the line: 4.5 to 1 passes, just under does not", () => {
    expect(contrastWithWhite("#767676")).toBeGreaterThanOrEqual(4.5);
    expect(accentError("#767676")).toBeNull();
    expect(accentError("#777777")).toMatch(/Too light/);
  });
  it("wants a six-digit colour, with or without the hash, in any case", () => {
    expect(normalizeHex("c2410c")).toBe("#C2410C");
    expect(normalizeHex(" #c2410c ")).toBe("#C2410C");
    for (const bad of ["#fff", "red", "#12345", "#GGGGGG", "", null, 5]) expect(accentError(bad), String(bad)).toMatch(/six-digit/);
  });
  it("hovers lighter on near-black and darker on a colour, so white text stays readable", () => {
    expect(contrastWithWhite(accentHover(DEFAULT_ACCENT))).toBeLessThan(contrastWithWhite(DEFAULT_ACCENT));
    for (const s of ACCENT_SWATCHES.slice(1)) expect(contrastWithWhite(accentHover(s.hex)), s.name).toBeGreaterThanOrEqual(4.5);
  });
});

describe("team colours", () => {
  it("has ten palette colours and the re-picked defaults for the eight teams", () => {
    expect(PALETTE_HEX).toHaveLength(10);
    expect(DEFAULT_TEAM_COLORS).toMatchObject({ Sales: "#0337DC", SDR: "#1A89C5", Marketing: "#E83CCB", "Field Marketing": "#805EF9", "Demand Gen": "#7C09AA", RevOps: "#0F9B23", Partnerships: "#306406", "Customer Success": "#8B2F52" });
    expect(new Set(Object.values(DEFAULT_TEAM_COLORS)).size).toBe(Object.values(DEFAULT_TEAM_COLORS).length);
  });
  it("accepts palette colours only, one per team", () => {
    expect(checkTeamColors({ Sales: "#0337DC", SDR: "#1a89c5" })).toEqual({ value: { Sales: "#0337DC", SDR: "#1A89C5" } });
    expect(checkTeamColors({ Sales: "#FF0000" })).toMatchObject({ error: expect.stringContaining("one of the ten") });
    expect(checkTeamColors({ Sales: "#0337DC", SDR: "#0337DC" })).toMatchObject({ error: expect.stringContaining("Two teams cannot share one") });
    expect(checkTeamColors([])).toHaveProperty("error");
    expect(checkTeamColors(null)).toHaveProperty("error");
  });
  it("gives every team a colour; no two teams in the palette share one", () => {
    const teams = [...TEAMS, "CRM Desk", "Events Desk", "GTM Backlog", "Next system", "Shared world"];
    const r = resolveTeamColors(null, teams);
    const held = teams.filter((t) => r.inPalette.has(t));
    expect(new Set(held.map((t) => r.color[t])).size).toBe(held.length);
    expect(r.color.Sales).toBe("#0337DC");
    expect(r.color["Ways of working"]).toBe("#A663AC");
    expect(r.color["CRM Desk"]).toBe("#5658AB");
    expect(r.free).toEqual([]);
    for (const t of ["Events Desk", "GTM Backlog", "Next system", "Shared world"]) { expect(r.inPalette.has(t)).toBe(false); expect(r.color[t]).toMatch(/^#[0-9A-F]{6}$/); }
    // teams beyond the palette keep the same fallback every time
    expect(resolveTeamColors(null, teams).color["Events Desk"]).toBe(r.color["Events Desk"]);
  });
  it("lets a team take a colour another team's default held, and the displaced team falls back", () => {
    const r = resolveTeamColors({ SDR: "#0337DC", Sales: "#A663AC" }, teamsOf([]));
    expect(r.color.SDR).toBe("#0337DC");
    expect(r.color.Sales).toBe("#A663AC");
    expect(r.color["Ways of working"]).not.toBe("#A663AC"); // its spare default was taken, so it is out of the palette until one frees up
    expect(r.free).toContain("#1A89C5");
  });
});

let db: Db, app: ReturnType<typeof createApp>;
beforeAll(async () => {
  db = await pglite();
  await migrate(db, allMigrations());
  app = createApp(() => db, { demo: true });
});
afterAll(() => db.close());

const put = (key: string, value: unknown, actor = "Ana") =>
  app.request(`/api/settings/${key}`, { method: "PUT", headers: { "content-type": "application/json", "x-actor": actor }, body: JSON.stringify({ value }) });
const state = async () => (await (await app.request("/api/state")).json()) as { meta: { settings: { accent: string; team_colors: Record<string, string>; team_glyphs: Record<string, string | null> } }; events: { kind: string; item_id: string | null; actor: string; detail: string }[] };

describe("PUT /api/settings/:key", () => {
  it("starts on the default accent with no stored team colours", async () => {
    expect((await state()).meta.settings).toEqual({ accent: DEFAULT_ACCENT, team_colors: {}, team_glyphs: {} });
  });
  it("stores the accent, normalised, and exposes it in the state", async () => {
    const res = await put("accent", "c2410c");
    expect(res.status).toBe(200);
    expect((await state()).meta.settings.accent).toBe("#C2410C");
  });
  it("logs the change as an event that belongs to no item", async () => {
    const e = (await state()).events.find((x) => x.kind === "settings")!;
    expect(e).toMatchObject({ item_id: null, actor: "Ana" });
    expect(e.detail).toContain("#C2410C");
  });
  it("refuses a colour too light for white text, with the reason, and keeps the old one", async () => {
    const res = await put("accent", "#FFE08A");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Too light for white text/);
    expect((await state()).meta.settings.accent).toBe("#C2410C");
  });
  it("refuses a word that is not a colour", async () => {
    expect((await put("accent", "orange")).status).toBe(400);
  });
  it("stores team colours, refuses a duplicate and a colour off the palette", async () => {
    expect((await put("team_colors", { Sales: "#A663AC" })).status).toBe(200);
    expect((await state()).meta.settings.team_colors).toEqual({ Sales: "#A663AC" });
    const dup = await put("team_colors", { Sales: "#A663AC", SDR: "#A663AC" });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toMatch(/cannot share/);
    expect((await put("team_colors", { Sales: "#123456" })).status).toBe(400);
    expect((await state()).meta.settings.team_colors).toEqual({ Sales: "#A663AC" });
  });
  it("stores team glyphs, refuses an unknown glyph and a glyph two teams would share", async () => {
    expect((await put("team_glyphs", { Sales: "diamond", SDR: null })).status).toBe(200);
    expect((await state()).meta.settings.team_glyphs).toEqual({ Sales: "diamond", SDR: null });
    const dup = await put("team_glyphs", { Sales: "bolt", SDR: "bolt" });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toMatch(/cannot share/);
    const bad = await put("team_glyphs", { Sales: "smiley" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/glyphs offered/);
    expect((await put("team_glyphs", ["bolt"])).status).toBe(400);
    expect((await state()).meta.settings.team_glyphs).toEqual({ Sales: "diamond", SDR: null });
    expect((await state()).events.find((x) => x.kind === "settings")!.detail).toBe("Changed the team glyphs");
  });
  it("refuses a setting that does not exist", async () => {
    expect((await put("theme", "dark")).status).toBe(404);
  });
  it("needs a name, like every other write", async () => {
    const res = await app.request("/api/settings/accent", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "#1D4ED8" }) });
    expect(res.status).toBe(400);
  });
});

describe("the ACCENT variable", () => {
  it("is the accent until one is stored, and an unusable one is ignored", async () => {
    const d = await pglite();
    await migrate(d, allMigrations());
    const read = async (accent?: string) => ((await (await createApp(() => d, { demo: true, accent }).request("/api/state")).json()) as { meta: { settings: { accent: string } } }).meta.settings.accent;
    expect(await read("#0F766E")).toBe("#0F766E");
    expect(await read("#FFEB3B")).toBe(DEFAULT_ACCENT);
    expect(await read("nonsense")).toBe(DEFAULT_ACCENT);
    expect(await read(undefined)).toBe(DEFAULT_ACCENT);
    await d.query("INSERT INTO settings (key, value) VALUES ('accent', '\"#B91C1C\"')");
    expect(await read("#0F766E")).toBe("#B91C1C"); // a stored setting wins
    await d.close();
  });
});

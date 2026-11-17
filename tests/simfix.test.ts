/* Simulation fixes (2026-11-17): the plain words, the sample notice, the Scores updated line, the landing paths, matching live figures and readable text colours. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { columnSums } from "../src/app/board-logic";
import { isSilent, SILENT_AFTER_DAYS, type Item, type ShipLogEntry } from "../src/shared/domain";
import { changedFields, scoresUpdatedLine } from "../src/shared/scores-updated";
import { BUYER_NEXT_STEP, BUYER_PATH, CONTACT_PLACEHOLDER, DEMO_NOTICE, DEMO_NOTICE_SHORT, DEMO_SAVE_LINE, HIRING_PATH, VALUE_LINE, VIEW_WORDS, WORDS, buyerNextStep, wordsFor } from "../src/shared/words";
import { signinPathsHtml } from "../src/server/signin-queue";
import { renderSignin } from "../src/server/auth";

const all = [VALUE_LINE, DEMO_NOTICE, BUYER_NEXT_STEP, ...HIRING_PATH, ...BUYER_PATH, ...VIEW_WORDS.flatMap((v) => [v.name, v.line]), ...WORDS.flatMap((w) => [w.term, w.line])];

describe("the vocabulary", () => {
  it("explains every term the simulation flagged, and the four screens", () => {
    const terms = WORDS.map((w) => w.term);
    for (const t of ["Impact", "Reach", "Confidence", "Effort", "Score", "Silent", "Drift", "Proposed scores", "Open PRs, Merged", "Tool names"]) expect(terms, t).toContain(t);
    expect(VIEW_WORDS.map((v) => v.name)).toEqual(["Triage", "Queue", "Board", "Shipped"]);
  });
  it("states the score formula and the silence window from the code, not from memory", () => {
    expect(WORDS.find((w) => w.term === "Score")!.line).toContain("Impact × reach × confidence ÷ effort");
    expect(WORDS.find((w) => w.term === "Silent")!.line).toContain(`${SILENT_AFTER_DAYS} days`);
  });
  it("has no em dashes, and the buyer's next step carries a placeholder, not an invented address", () => {
    for (const t of all) expect(t, t).not.toContain("—");
    expect(BUYER_NEXT_STEP).toContain(CONTACT_PLACEHOLDER);
    expect(BUYER_NEXT_STEP).not.toMatch(/https?:|@\w+\.\w+/);
  });
  it("tells the truth about the public demo: edits are kept, then reset", () => {
    expect(DEMO_NOTICE).toContain("invented data");
    expect(DEMO_NOTICE).toContain("until the demo restarts");
    expect(DEMO_NOTICE).toContain("on every start");
    expect(DEMO_NOTICE).toContain("06:00 UTC");
    expect(DEMO_SAVE_LINE).toContain("until the demo restarts");
    expect(`${DEMO_NOTICE} ${DEMO_SAVE_LINE}`).not.toMatch(/kept until/);
  });
  it("hides the Next step line while the contact is a placeholder, and shows it for a real one", () => {
    expect(buyerNextStep()).toBeNull();
    expect(buyerNextStep("hello@example.com")).toBe("To run this on your own requests, contact us at hello@example.com.");
  });
  it("keeps demo-only wording out of the real space's glossary", () => {
    const real = wordsFor(false);
    expect(real.map((w) => w.term)).not.toContain("Tool names");
    for (const w of real) expect(w.line, w.term).not.toMatch(/\bdemo\b|sample/i);
    expect(real.map((w) => w.term)).toContain("Open PRs, Merged");
    expect(wordsFor(true)).toEqual(WORDS);
  });
  it("describes the Board without calling Live requests open", () => {
    expect(VIEW_WORDS.find((v) => v.name === "Board")!.line).toContain("Idea and Building (the open ones");
  });
});

describe("the landing page paths", () => {
  const html = signinPathsHtml();
  it("shows the sample notice and both paths, and no placeholder text", () => {
    expect(html).toContain("invented data");
    expect(html).toContain("If you are hiring");
    expect(html).toContain("If you are buying");
    expect(html).not.toContain("Next step:");
    expect(html).not.toContain(CONTACT_PLACEHOLDER.replace(/[<>&]/g, ""));
    expect((html.match(/<li>/g) ?? []).length).toBe(HIRING_PATH.length + BUYER_PATH.length);
  });
  it("lands in the page where the template has its marker", () => {
    expect(renderSignin("a<!--paths-->b", undefined, { paths: "X" })).toBe("aXb");
    expect(renderSignin("a<!--paths-->b")).toBe("ab");
  });
});

describe("Scores updated", () => {
  const before = { impact: 3, reach: 25, confidence: 80, effort_days: 3 };
  it("lists what changed and the rank before and after", () => {
    const after = { ...before, impact: 4, reach: 60 };
    expect(changedFields(before, after)).toEqual(["impact", "reach"]);
    expect(scoresUpdatedLine(before, after, 9, 2, "A sample proposal")).toBe("Scores updated: A sample proposal proposed new values (Impact 3 to 4, Reach 25 to 60). It now lands at #2, was #9.");
  });
  it("says when the rank did not move, and says nothing when no value changed", () => {
    expect(scoresUpdatedLine(before, { ...before, effort_days: 4 }, 3, 3, "x")).toContain("It stays at #3.");
    expect(scoresUpdatedLine(before, { ...before }, 3, 3, "x")).toBeNull();
  });
});

describe("Board and Shipped agree on the live figures", () => {
  const NOW = new Date("2026-11-17T12:00:00Z");
  const live = (id: string): Item => ({ id, stage: "live", live_at: "2026-06-01T00:00:00Z", stage_changed_at: "2026-06-01T00:00:00Z" }) as Item;
  const entry = (item_id: string, date: string): ShipLogEntry => ({ id: item_id + date, item_id, date, metric: "m", value: 1, unit: "x", note: null, source_url: null, created_at: date });
  const items = ["a", "b", "c", "d", "e"].map(live);
  // a, b, c reported recently; d reported once, long ago (silent, but it has a "Measured" date); e never reported (silent).
  const log = [entry("a", "2026-11-10"), entry("b", "2026-11-01"), entry("c", "2026-11-12"), entry("d", "2026-09-08")];
  it("counts 5 live as 3 measured and 2 silent, and a long-ago result is not measured", () => {
    expect(columnSums("live", items, [], log, NOW)).toEqual({ measured: 3, silent: 2 });
    expect(isSilent(items[3], log.filter((l) => l.item_id === "d"), NOW)).toBe(true);
  });
});

describe("text contrast", () => {
  const css = readFileSync(new URL("../src/app/styles.css", import.meta.url), "utf8");
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))![1];
  const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const grounds = ["bg", "panel", "rail", "row-hover", "row-active", "row-focus"];
  it("keeps every grey text colour at 4.5:1 or more on every ground it sits on", () => {
    for (const fg of ["ink-2", "ink-3", "ink-4"]) for (const bg of grounds) expect(ratio(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps a visible step between ink-3 and ink-4 while both pass", () => {
    expect(token("ink-3")).not.toBe(token("ink-4"));
    expect(ratio(token("ink-3"), token("panel")) - ratio(token("ink-4"), token("panel"))).toBeGreaterThanOrEqual(0.7);
  });
  it("keeps the toast's muted icon colour readable on the toast", () => {
    expect(ratio(token("toast-mute"), token("toast"))).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps route fade-ins at 150 ms or less", () => {
    for (const m of css.matchAll(/animation:\s*(page-in|swap-in)\s+(\d+)ms/g)) expect(Number(m[2])).toBeLessThanOrEqual(150);
  });
});

describe("the demo bar on a phone", () => {
  const css = readFileSync(new URL("../src/app/styles.css", import.meta.url), "utf8");
  it("swaps the long notice for a one-line one so the bar stays within two lines at 390 px", () => {
    expect(DEMO_NOTICE_SHORT.length).toBeLessThanOrEqual(55);
    expect(DEMO_NOTICE_SHORT).toContain("until the demo restarts");
    expect(DEMO_NOTICE_SHORT).not.toContain("\u2014");
    expect(css).toMatch(/\.demo-short\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@media \(max-width: 760px\)\s*\{[^}]*\.demo-bar[\s\S]*?\.demo-long\s*\{\s*display:\s*none[\s\S]*?\.demo-short\s*\{\s*display:\s*block/);
  });
});

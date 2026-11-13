/* The design-lint gate: banned UI patterns ("the AI tells") fail the suite. Rules and rulings: BRYAN-DESIGN-INSTRUMENT.md, "Banned: the AI tells".
   Existing violations are listed in docs/DESIGN-LINT-BASELINE.txt for Bryan to review; only violations not in that file fail here.
   Run by hand: node scripts/design-lint.mjs */

import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs script, shared with the command line
import { newViolations, lintFiles, show, MESSAGE } from "../scripts/design-lint.mjs";

describe("design lint", () => {
  it("no banned UI pattern beyond the baseline", () => {
    const fresh = (newViolations() as unknown[]).map((v) => show(v));
    expect(fresh, MESSAGE as string).toEqual([]);
  });
});

type V = { rule: string };
const css = (raw: string) => (lintFiles([{ f: "x/styles.css", rel: "src/app/styles.css", raw }]) as V[]).map((v) => v.rule);
const tsx = (raw: string) => (lintFiles([{ f: "x/View.tsx", rel: "src/app/View.tsx", raw }]) as V[]).map((v) => v.rule);

describe("the rules a script can check", () => {
  it("state-colour: coloured text on a silent, stale or decline class", () => {
    expect(css(`:root{--warn:#B45309} .stage.silent { color: var(--warn); }`)).toContain("state-colour");
    expect(css(`.score.stale { color: #2563EB; }`)).toContain("state-colour");
    expect(css(`.btn.decline { color: #B91C1C; }`)).toContain("state-colour");
    expect(css(`.stage.silent { color: #09090B; font-weight: 600; } .score.stale { color: #A1A1AA; }`)).not.toContain("state-colour");
  });

  it("status-glyph: a Mark or a mark class before a status word", () => {
    expect(tsx(`export const A = () => <span className="stage"><Mark kind="silent" />Silent</span>;`)).toContain("status-glyph");
    expect(tsx(`export const A = () => <svg className="mark" viewBox="0 0 10 10" />;`)).toContain("status-glyph");
    expect(tsx(`export const A = () => <span className="stage">Silent</span>;`)).not.toContain("status-glyph");
  });

  it("text-link-cta: a text link doing a button's job", () => {
    for (const text of ["Open “Title”", "Undo", "Source thread", "System", "Open the board"])
      expect(tsx(`export const A = () => <a className="link" href="/x">${text}</a>;`), text).toContain("text-link-cta");
    expect(tsx(`export const A = () => <a className="btn quiet" href="/x">Open item</a>;`)).not.toContain("text-link-cta");
  });

  it("underlined-action: a link or button underlined at rest", () => {
    expect(css(`.toast .btn.text { text-decoration: underline; }`)).toContain("underlined-action");
    expect(css(`.link { text-decoration: underline; }`)).toContain("underlined-action");
    expect(css(`.ship-row a.t:hover { text-decoration: underline; }`)).not.toContain("underlined-action");
  });

  it("explainer: a sentence in a sub, hint, caption or note, or a sub= prop", () => {
    expect(tsx(`export const A = () => <p className="hint">Accepting moves it to Idea at the top.</p>;`)).toContain("explainer");
    expect(tsx(`export const A = () => <span className="note">named, not started, shipped and running.</span>;`)).toContain("explainer");
    expect(tsx(`export const A = () => <Dialog title="New" sub="It lands in Triage, where the engineer scores it.">x</Dialog>;`)).toContain("explainer");
    expect(tsx(`export const A = () => <span className="hint">Lands in the queue at</span>;`)).not.toContain("explainer");
    expect(tsx(`export const A = () => <p className="hint">Nothing to decide.</p>;`)).not.toContain("explainer");
  });

  it("literal-colour: a hex colour in a rule instead of a token", () => {
    expect(css(`.btn.primary { background: #18181B; color: #fff; }`)).toContain("literal-colour");
    expect(css(`.toast { box-shadow: inset 0 0 0 1px #1a1a1a; }`)).toContain("literal-colour");
    expect(css(`:root { --accent: #18181B; --accent-ink: #FAFAFA; } .btn.primary { background: var(--accent); color: var(--accent-ink); }`)).not.toContain("literal-colour");
    expect(css(`.mini { box-shadow: 0 0 0 1px rgba(9, 9, 11, 0.08); } .select { background-image: url("data:image/svg+xml,%3Csvg stroke='%2371717A'/%3E"); }`)).not.toContain("literal-colour");
    expect(css(`/* design-lint: allow a brand mark has its own fixed colour */\n.logo { fill: #E4572E; }`)).not.toContain("literal-colour");
  });

  it("type-sizes: more than four font sizes in one stylesheet", () => {
    const five = `a{font:400 12px/18px x} b{font:400 13px/19px x} c{font-size:14px} d{font:600 20px/26px x} e{font-size:11px}`;
    expect(css(five)).toContain("type-sizes");
    expect(css(five.replace("e{font-size:11px}", ""))).not.toContain("type-sizes");
    // avatar initials sit in a circle and are not counted
    expect(css(`${five.replace("e{font-size:11px}", "")} .av.sm{font-size:8px}`)).not.toContain("type-sizes");
  });

  it("T17 reduced motion: a moving transition, animation or press needs an override", () => {
    const base = `@keyframes rise { from { opacity: 0; transform: translateY(8px); } } @keyframes fade { from { opacity: 0; } }`;
    expect(css(`.a { transition: transform 100ms; }`)).toContain("motion-transition");
    expect(css(`.a { transition: all 100ms; }`)).toContain("motion-transition");
    expect(css(`.a { transition: opacity 100ms, color 100ms; }`)).not.toContain("motion-transition");
    expect(css(`.a { transition: transform 100ms; } @media (prefers-reduced-motion: reduce) { *, *::before { transition-property: opacity, color !important; } }`)).not.toContain("motion-transition");
    expect(css(`${base} .d { animation: rise 200ms; }`)).toContain("motion-animation");
    expect(css(`${base} .d { animation: fade 200ms; }`)).not.toContain("motion-animation");
    expect(css(`${base} .d { animation: rise 200ms; } @media (prefers-reduced-motion: reduce) { .d { animation-name: fade; } }`)).not.toContain("motion-animation");
    expect(css(`.b:active { transform: scale(0.97); }`)).toContain("motion-press");
    expect(css(`.c[data-lift="true"] { scale: 1.02; }`)).toContain("motion-press");
    expect(css(`.b:active { transform: scale(0.97); } @media (prefers-reduced-motion: reduce) { .b:active { transform: none; } }`)).not.toContain("motion-press");
    expect(css(`.c[data-lift="true"] { scale: 1.02; } @media (prefers-reduced-motion: reduce) { .c[data-lift] { scale: 1; } }`)).not.toContain("motion-press");
    expect(css(`.toasts { transform: translateX(-50%); }`)).not.toContain("motion-press");
  });

  it("T17 reduced transparency: blur and a translucent fixed surface need a solid fallback", () => {
    expect(css(`.bar { backdrop-filter: blur(8px); }`)).toContain("blur");
    expect(css(`.bar { backdrop-filter: blur(8px); } @media (prefers-reduced-transparency: reduce) { .bar { backdrop-filter: none; } }`)).not.toContain("blur");
    expect(css(`.scrim { position: fixed; background: rgba(9, 9, 11, 0.28); }`)).toContain("translucent-surface");
    expect(css(`:root { --scrim: rgba(9, 9, 11, 0.28); } .scrim { position: fixed; background: var(--scrim); }`)).toContain("translucent-surface");
    expect(css(`:root { --scrim: rgba(9, 9, 11, 0.28); } .scrim { position: fixed; background: var(--scrim); } @media (prefers-reduced-transparency: reduce) { :root { --scrim: #C8C8CD; } }`)).not.toContain("translucent-surface");
    expect(css(`.scrim { position: fixed; background: #fff; }`)).not.toContain("translucent-surface");
  });

  it("T17 more contrast: --line must be redefined", () => {
    expect(css(`:root { --line: rgba(9, 9, 11, 0.08); }`)).toContain("contrast-tokens");
    expect(css(`:root { --line: rgba(9, 9, 11, 0.08); } @media (prefers-contrast: more) { :root { --line: rgba(9, 9, 11, 0.4); } }`)).not.toContain("contrast-tokens");
  });

  it("T17 motion-waapi: a script that animates movement must check reduced motion", () => {
    expect(tsx(`export const f = (c: HTMLElement) => c.animate([{ transform: "translate(4px, 0)" }, { transform: "none" }], { duration: 160 });`)).toContain("motion-waapi");
    expect(tsx(`const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;\nexport const f = (c: HTMLElement) => { if (!calm()) c.animate([{ transform: "translate(4px, 0)" }, { transform: "none" }], { duration: 160 }); };`)).not.toContain("motion-waapi");
    expect(tsx(`export const f = (c: HTMLElement) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100 });`)).not.toContain("motion-waapi");
  });
});

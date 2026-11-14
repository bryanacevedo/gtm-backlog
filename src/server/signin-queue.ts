/* The sign-in page's picture: the demo's own ranked Queue, written as HTML from the sample rows (seed.ts), never copied by hand.
   Rendered per request, so the stale mark and the order always match what the demo itself would show today. */

import { glyphById, monogram, resolveTeamGlyphs } from "../shared/glyphs.ts";
import { accentHover } from "../shared/settings.ts";
import { sampleQueue } from "./seed.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const num = (v: number) => (Math.abs(v) >= 100 ? n0.format(v) : n1.format(v));
const NIL = `<span class="nil">–</span>`;

/** The stage figures and the ranked rows, for the `<!--queue-->` slot. */
export function signinQueueHtml(nowMs: number = Date.now()): string {
  const q = sampleQueue(nowMs);
  const glyph = resolveTeamGlyphs(null, q.teams).glyph;
  // The same tile the app draws (TeamTile in ui.tsx): the accent, its glyph in the accent's ink, the letters when it has none.
  const tile = (t: string) => `<span class="team-av" aria-hidden="true">${glyph[t] ? `<svg viewBox="0 0 24 24"><path d="${glyphById(glyph[t])!.d}"/></svg>` : esc(monogram(t))}</span>`;
  const cell = (v: number | null, unit = "") => `<td class="num in">${v == null ? NIL : `${num(v)}${unit ? `<span class="unit">${unit}</span>` : ""}`}</td>`;
  const body = q.rows.map((r) => `
          <tr>
            <td class="rank">${r.rank ?? "–"}</td>
            <td class="title"><span>${esc(r.title)}</span></td>
            <td class="team">${tile(r.team)}${esc(r.team)}</td>
            <td class="stg${r.stage === "building" ? " on" : ""}">${r.stage === "building" ? "Building" : "Idea"}</td>
            ${cell(r.impact)}${cell(r.reach, "/wk")}${cell(r.confidence, "%")}${cell(r.effort, r.effort === 1 ? " day" : " days")}
            <td class="num sc">${r.score == null ? `<span class="score-none">Unscored</span>` : `<span class="score${r.stale ? " stale" : ""}">${n0.format(r.score)}</span>`}</td>
          </tr>`).join("");
  const fig = (label: string, n: number) => `<div><span class="label">${label}</span><span class="fig">${n}</span></div>`;
  return `<section class="la-ledger" aria-label="The demo backlog">
        <div class="la-figs">${fig("Idea", q.counts.idea)}${fig("Building", q.counts.building)}${fig("Live", q.counts.live)}${fig("Results", q.counts.results)}</div>
        <div class="page-head la-head">
          <h2>Queue</h2><span class="count"><span class="la-desk">${q.rows.length}</span><span class="la-phone">${Math.min(6, q.rows.length)} of ${q.rows.length}</span></span>
          <span class="spacer"></span><span class="sub">Acme GTM, sample data</span>
        </div>
        <table class="grid">
          <thead><tr><th>#</th><th>Request</th><th>Team</th><th>Stage</th><th class="num h-in">Impact</th><th class="num h-in">Reach</th><th class="num h-in">Confidence</th><th class="num h-in">Effort</th><th class="num">Score</th></tr></thead>
          <tbody>${body}
          </tbody>
        </table>
      </section>`;
}

/** The accent the page uses: the ACCENT variable's colour when it is usable, else nothing (the stylesheet's own ink). The page never reads a database. */
export function signinAccentCss(hex: string | null): string {
  return hex ? `<style>:root{--accent:${hex};--accent-hover:${accentHover(hex)};--accent-ink:#FFFFFF}</style>` : "";
}

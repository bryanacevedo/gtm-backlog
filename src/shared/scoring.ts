/* Proposed scores: the shape of a proposal, how a proposal is checked, and the trust figures (share accepted unchanged, drift per
   input). Pure functions, no I/O, shared by the server (which validates what the model returns) and the app (which shows the figures). */

import { CONFIDENCE } from "./domain.ts";

export const SCORE_FIELDS = ["impact", "reach", "confidence", "effort_days"] as const;
export type ScoreField = (typeof SCORE_FIELDS)[number];
export const FIELD_WORD: Record<ScoreField, string> = { impact: "Impact", reach: "Reach", confidence: "Confidence", effort_days: "Effort" };

export interface Proposal {
  id: string;
  item_id: string;
  impact: number;
  reach: number;
  confidence: number;
  effort_days: number;
  reason_impact: string;
  reason_reach: string;
  reason_confidence: string;
  reason_effort: string;
  /** The inputs the proposal says it is guessing at, rather than reading off the request or off past items. */
  guesses: ScoreField[];
  source: "claude" | "stand-in";
  model: string;
  prompt_version: string;
  examples_used: number;
  created_at: string;
  resolved_at: string | null;
  outcome: "accepted" | "adjusted" | "declined" | null;
  accepted_impact: number | null;
  accepted_reach: number | null;
  accepted_confidence: number | null;
  accepted_effort_days: number | null;
}

export const reasonOf = (p: Proposal, f: ScoreField): string =>
  f === "impact" ? p.reason_impact : f === "reach" ? p.reason_reach : f === "confidence" ? p.reason_confidence : p.reason_effort;

/** What the model is asked to return, and what a stand-in produces. */
export interface Drafted {
  impact: number; reach: number; confidence: number; effort_days: number;
  reasons: Record<ScoreField, string>;
  guesses: ScoreField[];
}

const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().replace(/—|–/g, ",").slice(0, 160) : "");

/** Checks and tidies a model's answer: whole impact 1 to 5, confidence one of 50/80/100, reach 0 or more, effort in half days.
    Returns the problem in words when it cannot be used, so nothing half-valid is stored. */
export function checkDrafted(x: unknown): { value: Drafted } | { error: string } {
  if (!x || typeof x !== "object") return { error: "The proposal was not an object." };
  const o = x as Record<string, unknown>;
  const impact = Math.round(Number(o.impact));
  if (!(impact >= 1 && impact <= 5)) return { error: "Impact must be 1 to 5." };
  const confidence = Number(o.confidence);
  if (!(CONFIDENCE as readonly number[]).includes(confidence)) return { error: "Confidence must be 50, 80 or 100." };
  const reach = Number(o.reach);
  if (!Number.isFinite(reach) || reach < 0) return { error: "Reach must be 0 or more." };
  const effortRaw = Number(o.effort_days);
  if (!Number.isFinite(effortRaw) || effortRaw <= 0) return { error: "Effort must be above 0." };
  const r = (o.reasons ?? {}) as Record<string, unknown>;
  const reasons = { impact: oneLine(r.impact), reach: oneLine(r.reach), confidence: oneLine(r.confidence), effort_days: oneLine(r.effort_days) };
  if (SCORE_FIELDS.some((f) => !reasons[f])) return { error: "Every input needs a reason." };
  const guesses = (Array.isArray(o.guesses) ? o.guesses : []).filter((g): g is ScoreField => (SCORE_FIELDS as readonly unknown[]).includes(g));
  return { value: { impact, reach: Math.round(reach), confidence, effort_days: Math.max(0.5, Math.round(effortRaw * 2) / 2), reasons, guesses: [...new Set(guesses)] } };
}

/* ------------------------------------------------------------------- trust */

export interface Trust {
  /** Resolved proposals that were accepted or adjusted. */
  decided: number;
  unchanged: number;
  /** Per input: how many of the decided ones were changed, and how far off the proposal was on average across all of them. */
  drift: Record<ScoreField, { changed: number; mean: number; unit: "points" | "percent" }>;
}

const accepted = (p: Proposal, f: ScoreField): number | null =>
  f === "impact" ? p.accepted_impact : f === "reach" ? p.accepted_reach : f === "confidence" ? p.accepted_confidence : p.accepted_effort_days;

/** The figures for the trust report. Impact and confidence drift in points, reach and effort in percent of what was proposed. Declined ones do not count. */
export function trustOf(all: Proposal[]): Trust {
  const done = all.filter((p) => p.outcome === "accepted" || p.outcome === "adjusted");
  const drift = {} as Trust["drift"];
  for (const f of SCORE_FIELDS) {
    const unit = f === "impact" || f === "confidence" ? "points" : "percent";
    let changed = 0, sum = 0;
    for (const p of done) {
      const a = accepted(p, f), was = p[f];
      if (a == null || a === was) continue;
      changed++;
      sum += unit === "points" ? Math.abs(a - was) : was > 0 ? (Math.abs(a - was) / was) * 100 : 100;
    }
    drift[f] = { changed, mean: done.length ? sum / done.length : 0, unit };
  }
  return { decided: done.length, unchanged: done.filter((p) => p.outcome === "accepted").length, drift };
}

/** Below this many decided proposals the figures say so instead of pretending to measure. */
export const TRUST_MIN = 5;

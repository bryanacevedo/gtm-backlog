/* Smart triage scoring. When a request arrives, Claude proposes Impact, Reach, Confidence and Effort, each with a one-line reason,
   and says which of them it is guessing at. The proposal is stored apart from the values a person accepts, with the model and
   prompt version; every accepted or adjusted proposal becomes an example in the next prompt, so it learns this backlog's calibration.

   The demo never calls a model: it gets stand-in proposals from the sample (standIn below). The real space's data goes only to
   the model, never to the demo. */

import Anthropic from "@anthropic-ai/sdk";
import { IMPACT_RUBRIC, type Item } from "../shared/domain.ts";
import { SCORE_FIELDS, checkDrafted, type Drafted, type Proposal } from "../shared/scoring.ts";
import type { Db } from "./db.ts";

export const PROMPT_VERSION = "v1";
/** A fast model: the proposal is one short structured answer. Override with SCORING_MODEL (measured in scripts/eval-scoring.mjs). */
export const DEFAULT_MODEL = "claude-haiku-5-5";

/* The rubric is the stable part of the prompt and is cached; the examples change after every decision and sit behind a second breakpoint. */
export const RUBRIC = `You propose scores for GTM engineering requests so a person can accept them with one click and adjust only what is wrong. The backlog ranks requests by value for revenue: score = impact x reach x confidence / effort. Propose the four inputs for the request you are given.

IMPACT is a whole number from 1 to 5, how much one success moves revenue:
${[1, 2, 3, 4, 5].map((n) => `  ${n}  ${IMPACT_RUBRIC[n]}`).join("\n")}
Use the full range. A request that only saves one person a few minutes is a 1 or 2. Reserve 5 for work that plainly moves bookings this quarter, such as speed to lead on inbound demand or a leak in the pipeline itself. Most requests are 2 to 4.

REACH is the number of accounts the work touches in a typical week. Count accounts, not people, records or emails. It is a plain number such as 8, 25, 140 or 400; it is not capped. If the request names a volume, use it; if it names a team or a process, estimate the accounts that team or process handles in a week.

CONFIDENCE is exactly 50, 80 or 100, how sure you are that the impact and reach numbers are right:
  50   A guess: the request gives little to go on.
  80   Some evidence: the request states a concrete problem or number.
  100  Measured: the request quotes a measured figure or the effect is obvious and countable.
Do not default to 80. Use 50 when the request is thin or vague.

EFFORT is engineering days to build it, in steps of 0.5. A single alert or field sync is 1 to 3 days. A new workflow across two systems is 4 to 8. Anything needing a new data model, matching logic or several integrations is 8 to 20. Include testing and rollout.

Every input needs a reason of one short line (under 140 characters) in plain words that points at something in the request or in a similar past request. Do not use dashes as punctuation. In "guesses" list the inputs you are guessing at, meaning you had nothing in the request or in the examples to ground them. A guess is honest; hiding one is not. If the examples show that this person usually scores a kind of request differently from the rubric, follow the examples: they are the person's own calibration.

Return only the structured answer.`;

export const SCHEMA = {
  type: "object",
  properties: {
    impact: { type: "integer" },
    reach: { type: "number" },
    confidence: { type: "integer", enum: [50, 80, 100] },
    effort_days: { type: "number" },
    reasons: {
      type: "object",
      properties: { impact: { type: "string" }, reach: { type: "string" }, confidence: { type: "string" }, effort_days: { type: "string" } },
      required: ["impact", "reach", "confidence", "effort_days"],
      additionalProperties: false,
    },
    guesses: { type: "array", items: { type: "string", enum: [...SCORE_FIELDS] } },
  },
  required: ["impact", "reach", "confidence", "effort_days", "reasons", "guesses"],
  additionalProperties: false,
} as const;

/* ---------------------------------------------------------------- examples */

export interface Example {
  title: string; problem: string; team: string; touches: string[];
  /** What this person ended up with. */
  final: { impact: number; reach: number; confidence: number; effort_days: number };
  /** What was proposed, when a proposal was adjusted: the correction is the lesson. */
  was?: { impact: number; reach: number; confidence: number; effort_days: number };
}

const MAX_EXAMPLES = 14;

/** The person's own history: adjusted proposals first (the corrections teach most), then accepted ones, then items they scored
    by hand. Newest first within each kind. `skipItem` keeps an item out of its own examples (the eval scores every item that way). */
export async function loadExamples(db: Db, skipItem?: string): Promise<Example[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT i.id, i.title, i.problem, i.team, i.touches,
            p.outcome, p.impact AS p_impact, p.reach AS p_reach, p.confidence AS p_confidence, p.effort_days AS p_effort,
            p.accepted_impact AS a_impact, p.accepted_reach AS a_reach, p.accepted_confidence AS a_confidence, p.accepted_effort_days AS a_effort,
            p.resolved_at
       FROM score_proposals p JOIN items i ON i.id = p.item_id
      WHERE p.outcome IN ('accepted', 'adjusted') AND p.source = 'claude' AND p.accepted_impact IS NOT NULL
      ORDER BY p.resolved_at DESC LIMIT 60`);
  const own = await db.query<Record<string, unknown>>(
    `SELECT id, title, problem, team, touches, impact, reach, confidence, effort_days
       FROM items WHERE impact IS NOT NULL AND reach IS NOT NULL AND confidence IS NOT NULL AND effort_days IS NOT NULL AND stage::text <> 'triage'
        AND NOT EXISTS (SELECT 1 FROM score_proposals p WHERE p.item_id = items.id AND p.outcome IN ('accepted', 'adjusted'))
      ORDER BY scored_at DESC NULLS LAST LIMIT 40`);
  const fromProposal = (r: Record<string, unknown>): Example => ({
    title: String(r.title), problem: String(r.problem), team: String(r.team), touches: (r.touches as string[]) ?? [],
    final: { impact: Number(r.a_impact), reach: Number(r.a_reach), confidence: Number(r.a_confidence), effort_days: Number(r.a_effort) },
    ...(r.outcome === "adjusted" ? { was: { impact: Number(r.p_impact), reach: Number(r.p_reach), confidence: Number(r.p_confidence), effort_days: Number(r.p_effort) } } : {}),
  });
  const adjusted = rows.filter((r) => r.outcome === "adjusted" && r.id !== skipItem).map(fromProposal);
  const taken = rows.filter((r) => r.outcome === "accepted" && r.id !== skipItem).map(fromProposal);
  const hand = own.filter((r) => r.id !== skipItem).map((r): Example => ({
    title: String(r.title), problem: String(r.problem), team: String(r.team), touches: (r.touches as string[]) ?? [],
    final: { impact: Number(r.impact), reach: Number(r.reach), confidence: Number(r.confidence), effort_days: Number(r.effort_days) },
  }));
  // Half the slots go to corrections, the rest are spread across accepted proposals and hand scores.
  const out: Example[] = [...adjusted.slice(0, 7)];
  const rest = [...taken, ...hand];
  for (let i = 0; out.length < MAX_EXAMPLES && (i < rest.length || adjusted.length > out.length); i++) {
    if (rest[i]) out.push(rest[i]);
    else if (adjusted[out.length]) out.push(adjusted[out.length]);
    else break;
  }
  return out.slice(0, MAX_EXAMPLES);
}

const sc = (v: Example["final"]) => `impact ${v.impact}, reach ${v.reach}, confidence ${v.confidence}, effort ${v.effort_days} days`;
export const examplesText = (ex: Example[]): string => ex.length
  ? `Past requests from this backlog and the scores this person settled on:\n\n${ex.map((e, i) => `Example ${i + 1}: ${e.title}\nTeam: ${e.team}. Touches: ${e.touches.join(", ") || "nothing named"}.\nProblem: ${e.problem}\nFinal scores: ${sc(e.final)}.${e.was ? `\nI had proposed ${sc(e.was)}, and they changed it to the final scores: learn from the change.` : ""}`).join("\n\n")}`
  : "There are no past decisions yet. Rely on the rubric and say so by listing guesses where you have nothing to go on.";

export type Req = { title: string; problem: string; team: string; touches: string[]; link: string | null; requester: string };
const requestText = (i: Req) =>
  `Propose scores for this request.\n\nTitle: ${i.title}\nTeam: ${i.team}\nAsked by: ${i.requester}\nTouches: ${i.touches.join(", ") || "nothing named"}\nLink: ${i.link ? "yes, a source thread is attached" : "none"}\nProblem: ${i.problem}`;

/* ------------------------------------------------------------------ Claude */

export interface ScoringClient { messages: Pick<Anthropic["messages"], "create"> }
export const makeClient = (apiKey: string): ScoringClient => new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 });

export interface Made { drafted: Drafted; model: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number } }

export async function proposeWithClaude(client: ScoringClient, item: Req, examples: Example[], model = DEFAULT_MODEL): Promise<Made> {
  const res = await client.messages.create({
    model,
    max_tokens: 1200,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    system: [
      { type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } },
      { type: "text", text: examplesText(examples), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: requestText(item) }],
  } as never) as Anthropic.Message;
  if (res.stop_reason === "refusal") throw new Error("The model declined to score this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The model's answer was cut off.");
  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  let raw: unknown;
  try { raw = JSON.parse(block?.text ?? ""); } catch { throw new Error("The model's answer could not be read."); }
  const checked = checkDrafted(raw);
  if ("error" in checked) throw new Error(checked.error);
  const u = res.usage as unknown as Record<string, number | undefined>;
  return { drafted: checked.value, model, usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 } };
}

/* ---------------------------------------------------------------- stand-in */

/* The demo's proposals. Nothing is called and no real data is involved: recorded answers for the sample's own triage requests,
   and for a request someone types into the demo, a rule of thumb on what it touches. They are labelled as samples on screen. */
const RECORDED: Record<string, Drafted> = {
  "Sync event leads to the CRM same day": {
    impact: 4, reach: 60, confidence: 80, effort_days: 4,
    reasons: { impact: "A week of delay on event leads is a week of lost follow-up, like the attendee-list build.", reach: "An event brings about 60 new accounts to the CRM in the week after it.", confidence: "The delay is stated plainly, but the volume per event is not.", effort_days: "One sync job and a badge-scan format; a few days with testing." },
    guesses: ["reach"],
  },
  "Slack alert when a target account visits pricing": {
    impact: 3, reach: 25, confidence: 50, effort_days: 2,
    reasons: { impact: "Timely nudges help sellers, but one alert does not create pipeline alone.", reach: "A target list of this size sees a few dozen accounts on pricing in a week.", confidence: "No visit volume is given, so this rests on a rule of thumb.", effort_days: "One alert on an existing analytics event." },
    guesses: ["reach", "confidence"],
  },
  "Clean job titles for segmentation": {
    impact: 3, reach: 120, confidence: 80, effort_days: 5,
    reasons: { impact: "Better persona segments improve every campaign that follows, a pipeline input.", reach: "Every account in a campaign list carries titles, so most of the weekly sends are affected.", confidence: "The 400 spellings are a concrete number.", effort_days: "A mapping table plus matching rules and a backfill." },
    guesses: [],
  },
};
const BY_TOUCH: Record<string, { impact: number; effort: number }> = {
  pipeline: { impact: 4, effort: 5 }, meetings: { impact: 4, effort: 4 }, speed: { impact: 3, effort: 3 },
  "data quality": { impact: 3, effort: 5 }, reporting: { impact: 2, effort: 4 },
};

/** A rule-of-thumb proposal for a demo request: a sample, not a model. */
export function standIn(item: Pick<Item, "title" | "touches" | "problem" | "link">): Drafted {
  const rec = RECORDED[item.title];
  if (rec) return rec;
  const picks = item.touches.map((t) => BY_TOUCH[t]).filter(Boolean);
  const impact = picks.length ? Math.max(...picks.map((p) => p.impact)) : 2;
  const effort = picks.length ? Math.round((picks.reduce((n, p) => n + p.effort, 0) / picks.length) * 2) / 2 : 3;
  const detailed = item.problem.length > 110 || !!item.link;
  return {
    impact, reach: 25, confidence: detailed ? 80 : 50, effort_days: effort,
    reasons: {
      impact: picks.length ? `Touches ${item.touches.join(" and ")}, which the rubric puts at ${impact}.` : "Nothing it touches is named, so this is the low end.",
      reach: "A typical weekly volume for one team; the request gives no number.",
      confidence: detailed ? "The request describes the problem in some detail." : "The request is short, so this is a guess.",
      effort_days: "A typical size for work of this kind.",
    },
    guesses: detailed ? ["reach"] : ["reach", "confidence", "effort_days"],
  };
}

/* ------------------------------------------------------------------- store */

export const PROPOSAL_COLS = `id, item_id, impact, reach, confidence, effort_days, reason_impact, reason_reach, reason_confidence, reason_effort,
  guesses, source, model, prompt_version, examples_used, created_at, resolved_at, outcome, accepted_impact, accepted_reach, accepted_confidence, accepted_effort_days`;

export async function saveProposal(db: Db, itemId: string, made: { drafted: Drafted; source: "claude" | "stand-in"; model: string; examples: number }): Promise<Proposal> {
  const id = `sp_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const d = made.drafted;
  await db.query(
    `INSERT INTO score_proposals (id, item_id, impact, reach, confidence, effort_days, reason_impact, reason_reach, reason_confidence, reason_effort, guesses, source, model, prompt_version, examples_used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, itemId, d.impact, d.reach, d.confidence, d.effort_days, d.reasons.impact, d.reasons.reach, d.reasons.confidence, d.reasons.effort_days, d.guesses, made.source, made.model, PROMPT_VERSION, made.examples]);
  return (await db.query<Proposal>(`SELECT ${PROPOSAL_COLS} FROM score_proposals WHERE id = $1`, [id]))[0];
}

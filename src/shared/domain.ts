/* The rules of the backlog, in one place, with no I/O.
   The Worker enforces them and the app uses them to predict the result of a
   move before the server confirms it (optimistic UI), so both must agree. */

export const STAGES = ["triage", "idea", "building", "live", "declined", "retired"] as const;
export type Stage = (typeof STAGES)[number];

/** The three stages a build passes through. The Board shows only these. */
export const FLOW: Stage[] = ["idea", "building", "live"];
/** What the Queue ranks: work that is wanted but not shipped. */
export const OPEN: Stage[] = ["idea", "building"];

export const TEAMS = ["Sales", "SDR", "Marketing", "Field Marketing", "Demand Gen", "RevOps", "Partnerships", "Customer Success"] as const;
export type Team = (typeof TEAMS)[number];

/** What a request touches. Used to explain impact, not to compute it. */
export const TOUCHES = ["pipeline", "meetings", "data quality", "speed", "reporting"] as const;
export type Touch = (typeof TOUCHES)[number];

export const CONFIDENCE = [50, 80, 100] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export interface Item {
  id: string;
  title: string;
  problem: string;
  team: Team;
  requester: string;
  touches: Touch[];
  link: string | null;
  stage: Stage;
  owner: string | null;
  impact: number | null;      // 1 to 5, how much revenue it moves
  reach: number | null;       // accounts affected per week (one unit for every item)
  confidence: Confidence | null;
  effort_days: number | null; // engineering days to ship
  scored_at: string | null;   // when any score input last changed
  scored_by: string | null;
  system_url: string | null;  // where the shipped system lives
  target_date: string | null; // ISO date
  decision_note: string | null; // why it was declined, merged or retired
  merged_into: string | null;
  live_at: string | null;     // first time it went live
  created_at: string;         // ISO datetime
  updated_at: string;
  stage_changed_at: string;
}

export interface ShipLogEntry {
  id: string;
  item_id: string;
  date: string;     // ISO date the result was measured
  metric: string;   // e.g. "meetings booked"
  value: number;
  unit: string;     // e.g. "meetings", "%", "hours saved"
  note: string | null;
  source_url: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  item_id: string;
  at: string;
  actor: string;
  kind: "created" | "triaged" | "moved" | "edited" | "logged";
  detail: string; // short human sentence, already formatted
}

/* ------------------------------------------------------------------ score */

export interface ScoreInputs {
  impact: number | null;
  reach: number | null;
  confidence: number | null;
  effort_days: number | null;
}

/** Impact x reach x confidence / effort. Null when any input is missing:
    a score with no inputs is not shown as a score. */
export function score(x: ScoreInputs): number | null {
  const { impact, reach, confidence, effort_days } = x;
  if (impact == null || reach == null || confidence == null || effort_days == null) return null;
  if (effort_days <= 0) return null;
  return (impact * reach * (confidence / 100)) / effort_days;
}

export function missingInputs(x: ScoreInputs): (keyof ScoreInputs)[] {
  return (["impact", "reach", "confidence", "effort_days"] as const).filter((k) => x[k] == null);
}

/** Queue order: scored items by score, then unscored by age (oldest first). */
export function rank<T extends Item>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sa = score(a), sb = score(b);
    if (sa != null && sb != null) return sb - sa || a.created_at.localeCompare(b.created_at);
    if (sa != null) return -1;
    if (sb != null) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

/* ------------------------------------------------------------- validation */

export function validateInputs(x: Partial<ScoreInputs>): string | null {
  if (x.impact != null && !(Number.isInteger(x.impact) && x.impact >= 1 && x.impact <= 5)) return "Impact is a whole number from 1 to 5.";
  if (x.reach != null && !(Number.isFinite(x.reach) && x.reach >= 0)) return "Reach is the number of accounts affected per week, 0 or more.";
  if (x.confidence != null && !(CONFIDENCE as readonly number[]).includes(x.confidence)) return "Confidence is 50, 80 or 100 percent.";
  if (x.effort_days != null && !(Number.isFinite(x.effort_days) && x.effort_days > 0)) return "Effort is a number of days above 0.";
  return null;
}

/* ----------------------------------------------------------------- stages */

const ALLOWED: Record<Stage, Stage[]> = {
  triage: ["idea", "declined"],
  idea: ["building", "declined", "triage"],
  building: ["idea", "live"],
  live: ["building", "retired"],
  declined: ["triage"],
  retired: ["live"],
};

export function canMove(from: Stage, to: Stage): boolean {
  return ALLOWED[from].includes(to);
}

/** Why a move is refused, in words for the person who tried it. Null when allowed. */
export function moveError(item: Pick<Item, "stage" | "system_url">, to: Stage, opts: { system_url?: string | null; note?: string | null } = {}): string | null {
  if (item.stage === to) return null;
  if (!canMove(item.stage, to)) return `An item in ${label(item.stage)} cannot move to ${label(to)}.`;
  if (to === "live" && !(opts.system_url ?? item.system_url)) return "Add the link to the shipped system before marking it live.";
  if ((to === "declined" || to === "retired") && !opts.note?.trim()) return `Say why it is ${to === "declined" ? "declined" : "retired"}; the requester sees this.`;
  return null;
}

export function label(s: Stage): string {
  return { triage: "Triage", idea: "Idea", building: "Building", live: "Live", declined: "Declined", retired: "Retired" }[s];
}

/* ------------------------------------------------------------------ silent */

export const SILENT_AFTER_DAYS = 30;

/** A live item with no ship-log entry in the last 30 days has gone silent:
    it may still run, but nobody can say what it is doing. */
export function isSilent(item: Pick<Item, "stage" | "live_at" | "stage_changed_at">, log: Pick<ShipLogEntry, "date">[], now: Date): boolean {
  if (item.stage !== "live") return false;
  const last = log.map((l) => l.date).sort().at(-1) ?? (item.live_at ?? item.stage_changed_at).slice(0, 10);
  return daysBetween(last, now) > SILENT_AFTER_DAYS;
}

export function daysBetween(isoDate: string, now: Date): number {
  const d = new Date(isoDate.length === 10 ? isoDate + "T00:00:00Z" : isoDate);
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/* ------------------------------------------------------------- staleness */

export const STALE_SCORE_DAYS = 60;

/** A score whose inputs nobody has looked at in 60 days still ranks, but renders faded. */
export function isScoreStale(item: Pick<Item, "scored_at">, now: Date): boolean {
  return item.scored_at != null && daysBetween(item.scored_at, now) > STALE_SCORE_DAYS;
}

export const IMPACT_RUBRIC: Record<number, string> = {
  1: "A convenience",
  2: "Saves a team time",
  3: "Improves a pipeline input",
  4: "Creates or protects pipeline",
  5: "Moves bookings this quarter",
};

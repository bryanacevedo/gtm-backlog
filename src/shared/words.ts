/* The plain words for this app's vocabulary, the demo's sample notice and the two short paths. One place, so the Guide, the
   tooltips and the landing page say the same thing. Copy states facts. No third-party tool is named as if it were connected. */

import { SILENT_AFTER_DAYS } from "./domain.ts";

/** A placeholder, not a real address. While it is still in this form the Next step line is not shown anywhere
    (see buyerNextStep): put the real link here and the line appears on the landing page and in Start here. */
export const CONTACT_PLACEHOLDER = "[contact link: to be added]";

/** Edits last until the demo restarts: it reloads the sample on every start (a deploy, or waking after idle) and nightly at 06:00 UTC. */
/** The same notice, short enough for one line on a phone. */
export const DEMO_NOTICE_SHORT = "Invented data. Edits last until the demo restarts.";
export const DEMO_NOTICE = "Sample company with invented data. Edits are shared with other visitors and last until the demo restarts. It reloads the sample on every start and every night at 06:00 UTC. Dates follow today's date.";
export const DEMO_SAVE_LINE = "Sample backlog: this change lasts until the demo restarts (it reloads on every start and nightly at 06:00 UTC).";

export const VALUE_LINE = "GTM engineering requests, ranked by what they are worth to revenue, from idea to live, with results after they ship.";

/** What each screen is for, one line each (also the title of its rail link). */
export const VIEW_WORDS: readonly { name: string; line: string }[] = [
  { name: "Triage", line: "New requests waiting for a decision. Accept puts one in the ranked queue; decline closes it." },
  { name: "Queue", line: "Every open request in rank order, highest score first." },
  { name: "Board", line: "Requests as cards in 3 columns: Idea and Building (the open ones, as in Queue) and Live (shipped)." },
  { name: "Shipped", line: "What has gone live, with the results logged after release." },
];

export const WORDS: readonly { term: string; line: string }[] = [
  { term: "Impact", line: "How much one success moves revenue, from 1 to 5." },
  { term: "Reach", line: "How many accounts it touches in a week." },
  { term: "Confidence", line: "How sure we are that the impact and reach numbers are right, from 50% (a guess) to 100% (measured)." },
  { term: "Effort", line: "Engineering days to build it." },
  { term: "Score", line: "Impact × reach × confidence ÷ effort. Higher means more value per day of work." },
  { term: "Silent", line: `A live request with no result logged in the last ${SILENT_AFTER_DAYS} days. It may still run, but nobody can say what it is doing.` },
  { term: "Measured", line: `A live request with a result logged in the last ${SILENT_AFTER_DAYS} days.` },
  { term: "Proposed scores", line: "In Triage, an AI model proposes the 4 score inputs. A person reviews them and decides. This demo shows sample proposals and makes no live call." },
  { term: "Drift", line: "How far a proposed value was from the value a person accepted, on average. Lower means the proposals held up." },
  { term: "Open PRs, Merged", line: "Pull requests: proposed code changes. Open means under review; merged means accepted into the code. The ones in this demo are sample data." },
  { term: "Tool names", line: "Names such as Slack, CRM or Google in request titles are sample text. Nothing in this demo connects to them." },
];

/** Words that mean something different, or nothing, outside the demo. */
const DEMO_ONLY_TERMS = ["Tool names"];
const REAL_LINES: Record<string, string> = {
  "Proposed scores": "In Triage, an AI model proposes the 4 score inputs. A person reviews them and decides.",
  "Open PRs, Merged": "Pull requests: proposed code changes. Open means under review; merged means accepted into the code.",
};
/** The glossary for the space the reader is in: the demo's own sample caveats appear only in the demo. */
export function wordsFor(demo: boolean): readonly { term: string; line: string }[] {
  if (demo) return WORDS;
  return WORDS.filter((w) => !DEMO_ONLY_TERMS.includes(w.term)).map((w) => ({ term: w.term, line: REAL_LINES[w.term] ?? w.line }));
}

export const HIRING_PATH: readonly string[] = [
  "Open Triage. Read a request and the scores an AI model proposed for it.",
  "Change a score and watch the rank preview move, then press Accept.",
  "Open Queue to find where it landed, ranked by score.",
  "Open Board and move a card from Idea to Building.",
  "Open Shipped and find the releases marked Silent.",
];

export const BUYER_PATH: readonly string[] = [
  "Triage: every request gets a decision and a score, not a place in someone's inbox.",
  "Queue: the ranking is one formula (impact × reach × confidence ÷ effort), explained in the Score heading.",
  "Shipped: results are logged after release, and a release with none is flagged Silent.",
];

export const BUYER_NEXT_STEP = `To run this on your own requests, contact us at ${CONTACT_PLACEHOLDER}.`;

/** The Next step line, or null while the contact is still the placeholder (no placeholder text is ever shown to a visitor). */
export function buyerNextStep(contact: string = CONTACT_PLACEHOLDER): string | null {
  return /^\[.*\]$/.test(contact) ? null : `To run this on your own requests, contact us at ${contact}.`;
}

/* The notice shown in Triage when proposed scores replace the starting values, so the rank preview never moves without a word. */

import { FIELD_WORD, SCORE_FIELDS, type ScoreField } from "./scoring.ts";

export type Values = Record<ScoreField, number>;

/** The inputs whose value differs, in display order. */
export const changedFields = (before: Values, after: Values): ScoreField[] => SCORE_FIELDS.filter((f) => before[f] !== after[f]);

/** One plain sentence, or null when nothing changed. `by` names who proposed; `from` and `to` are the rank before and after. */
export function scoresUpdatedLine(before: Values, after: Values, from: number, to: number, by: string): string | null {
  const fields = changedFields(before, after);
  if (!fields.length) return null;
  const what = fields.map((f) => `${FIELD_WORD[f]} ${before[f]} to ${after[f]}`).join(", ");
  const rank = from === to ? `It stays at #${to}.` : `It now lands at #${to}, was #${from}.`;
  return `Scores updated: ${by} proposed new values (${what}). ${rank}`;
}

/* Checks on a card: a review, a test run or any other verdict, written to the item's history as a
   'logged' event whose detail starts "<Check name>: pass" or "<Check name>: fail", the verdict ending
   the line or followed by punctuation (for example "Code review: pass. Covered by tests.";
   "Live: passed to the team" is not a check). No table of its own: the events are the record.
   The card shows the latest one. */

import type { EventRow } from "./domain";

export type Verdict = "pass" | "fail";
export interface Check { name: string; verdict: Verdict; at: string; detail: string }

const CHECK_RE = /^([A-Za-z][A-Za-z0-9 .\-]{0,30}?):\s*(pass|passed|fail|failed|blocked)(?=$|[.,;:)])/i;

/** The same rule for Postgres (`detail ~* CHECK_SQL`), so the server can send every item's latest check, however old. */
export const CHECK_SQL = "^[A-Za-z][A-Za-z0-9 .-]{0,30}:\\s*(pass|passed|fail|failed|blocked)($|[.,;:)])";

/** The check an event records, or null when it records something else. */
export function parseCheck(e: Pick<EventRow, "kind" | "detail" | "at">): Check | null {
  if (e.kind !== "logged") return null;
  const m = e.detail.match(CHECK_RE);
  if (!m) return null;
  const word = m[2].toLowerCase();
  return { name: m[1].trim(), verdict: word.startsWith("pass") ? "pass" : "fail", at: e.at, detail: e.detail };
}

/** Each item's latest check. */
export function latestChecks(events: EventRow[]): Map<string, Check> {
  const out = new Map<string, Check>();
  for (const e of events) {
    if (!e.item_id) continue;
    const c = parseCheck(e);
    if (!c) continue;
    const had = out.get(e.item_id);
    if (!had || had.at < c.at) out.set(e.item_id, c);
  }
  return out;
}

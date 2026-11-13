/* The Board's rules with no DOM: how a column is ordered, where a dragged card will land, what each column head adds up,
   which stage an arrow key means, and what the work links say about a build. Pure, so the tests can reach it. */

import { FLOW, isSilent, rank, score, type Item, type ShipLogEntry, type Stage } from "../shared/domain";
import type { WorkLink } from "../shared/work";

/** Idea and Building are ranked by score, unscored last (the Queue's own order). Live is newest first. The order is the product's, not the pointer's. */
export function sortStage(stage: Stage, items: Item[]): Item[] {
  return stage === "live"
    ? [...items].sort((a, b) => (b.live_at ?? "").localeCompare(a.live_at ?? ""))
    : rank(items);
}

/** The columns of the board for an optional team filter. */
export function columnsOf(items: Item[], team: string | null): Record<Stage, Item[]> {
  const mine = items.filter((i) => FLOW.includes(i.stage) && (!team || i.team === team));
  return Object.fromEntries(FLOW.map((s) => [s, sortStage(s, mine.filter((i) => i.stage === s))])) as Record<Stage, Item[]>;
}

/** The item as it would be once moved: a new stage, the day it changed, and (for Live) the day it first went live. */
export function movedTo(item: Item, to: Stage, nowIso: string): Item {
  return { ...item, stage: to, stage_changed_at: nowIso, live_at: to === "live" ? item.live_at ?? nowIso : item.live_at };
}

/** Where a card dropped in `stage` lands in that column: the place its rank gives it among the cards already there, not the place under the pointer. */
export function slotIndex(stage: Stage, column: Item[], moved: Item, nowIso: string): number {
  const others = column.filter((i) => i.id !== moved.id);
  const next = sortStage(stage, [...others, movedTo(moved, stage, nowIso)]);
  return next.findIndex((i) => i.id === moved.id);
}

/** The stage one step left or right of this one on the board, or null at an edge. */
export function stageStep(stage: Stage, dir: -1 | 1): Stage | null {
  const i = FLOW.indexOf(stage);
  return i < 0 ? null : FLOW[i + dir] ?? null;
}

/** The column whose centre is nearest the pointer. The whole column height is the target. */
export function nearestStage(x: number, centres: { stage: Stage; centre: number }[], fallback: Stage): Stage {
  let best = fallback, d = Infinity;
  for (const c of centres) { const dist = Math.abs(x - c.centre); if (dist < d) { d = dist; best = c.stage; } }
  return best;
}

/** What the work links say about a build: its pull requests, open and merged. Total is every pull request, so a build with none shows nothing. */
export function pullRequests(links: Pick<WorkLink, "item_id" | "kind" | "state">[], itemId: string) {
  let open = 0, merged = 0, total = 0;
  for (const l of links) if (l.item_id === itemId && l.kind === "pr") { total++; if (l.state === "open") open++; else if (l.state === "merged") merged++; }
  return { open, merged, total };
}

export interface ColumnSums { score?: number; unscored?: number; openPrs?: number; measured?: number; silent?: number }

/** The figures a column head carries. A figure that does not apply is left out, so nothing says "0" for something never tracked. */
export function columnSums(stage: Stage, list: Item[], links: Pick<WorkLink, "item_id" | "kind" | "state">[], log: ShipLogEntry[], now: Date): ColumnSums {
  if (!list.length) return {};
  const sum = () => Math.round(list.reduce((n, i) => n + (score(i) ?? 0), 0));
  if (stage === "idea") {
    const unscored = list.filter((i) => score(i) == null).length;
    return { score: sum(), ...(unscored ? { unscored } : {}) };
  }
  if (stage === "building") {
    const prs = list.map((i) => pullRequests(links, i.id));
    return { score: sum(), ...(prs.some((p) => p.total) ? { openPrs: prs.reduce((n, p) => n + p.open, 0) } : {}) };
  }
  const silent = list.filter((i) => isSilent(i, log.filter((l) => l.item_id === i.id), now)).length;
  const measured = list.filter((i) => log.some((l) => l.item_id === i.id) && !isSilent(i, log.filter((l) => l.item_id === i.id), now)).length;
  return { measured, ...(silent ? { silent } : {}) };
}

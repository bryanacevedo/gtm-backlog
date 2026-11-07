/* Client state. One snapshot from GET /api/state, then every change is applied
   locally first (so the screen answers in under 100ms) and reconciled with the
   server's answer. A refused change rolls back and says why. */

import { useSyncExternalStore } from "react";
import type { EventRow, Item, ShipLogEntry, Stage } from "../shared/domain";

export interface Snapshot {
  items: Item[];
  shipLog: ShipLogEntry[];
  events: EventRow[];
  meta: { demo: boolean; writeKey: boolean; now: string };
}

export interface Toast { id: number; text: string; tone: "info" | "error"; undo?: () => void }

type State = { data: Snapshot | null; loadError: string | null; toasts: Toast[]; actor: string | null; flash: string | null };

const ACTOR_KEY = "gtm-backlog.actor";
const KEY_KEY = "gtm-backlog.write-key";
const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: keep it in memory */ } };

let state: State = { data: null, loadError: null, toasts: [], actor: safeGet(ACTOR_KEY), flash: null };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => pick(state));
}
export const getState = () => state;

/* ----------------------------------------------------------------- toasts */

let toastSeq = 0;
export function toast(text: string, tone: Toast["tone"] = "info", undo?: () => void) {
  const id = ++toastSeq;
  set({ toasts: [...state.toasts.slice(-2), { id, text, tone, undo }] });
  setTimeout(() => dismiss(id), 8000);
}
export function dismiss(id: number) { set({ toasts: state.toasts.filter((t) => t.id !== id) }); }

/* ------------------------------------------------------------------ actor */

let actorResolver: ((name: string | null) => void) | null = null;
export const actorPrompt = { open: false };

/** Resolves with a name, asking once if the browser does not know it yet. */
export function needActor(): Promise<string | null> {
  if (state.actor) return Promise.resolve(state.actor);
  actorPrompt.open = true;
  set({});
  return new Promise((res) => { actorResolver = res; });
}
export function setActor(name: string | null) {
  actorPrompt.open = false;
  if (name) { safeSet(ACTOR_KEY, name); set({ actor: name }); } else set({});
  actorResolver?.(name); actorResolver = null;
}

/* -------------------------------------------------------------------- api */

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (method !== "GET") {
    const actor = await needActor();
    if (!actor) throw new Error("Add your name to make changes.");
    headers["x-actor"] = encodeURIComponent(actor);
    const key = safeGet(KEY_KEY);
    if (key) headers["x-write-key"] = key;
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Could not reach the backlog. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `The backlog answered ${res.status}.`);
  return json;
}

export async function load() {
  try {
    const data = await call<Snapshot>("GET", "/api/state");
    set({ data, loadError: null });
  } catch (e) {
    set({ loadError: (e as Error).message });
  }
}

/* -------------------------------------------------------------- mutations */

function replaceItem(item: Item) {
  if (!state.data) return;
  set({ data: { ...state.data, items: state.data.items.map((i) => (i.id === item.id ? item : i)) } });
}
function flash(id: string) { set({ flash: id }); setTimeout(() => state.flash === id && set({ flash: null }), 700); }
async function refreshEvents() {
  try { const d = await call<Snapshot>("GET", "/api/state"); set({ data: d }); } catch { /* the next load picks it up */ }
}

export async function createItem(input: Record<string, unknown>): Promise<Item | null> {
  try {
    const { item } = await call<{ item: Item }>("POST", "/api/items", input);
    if (state.data) set({ data: { ...state.data, items: [...state.data.items, item] } });
    toast(`Request added to Triage.`);
    refreshEvents();
    return item;
  } catch (e) {
    throw e;
  }
}

export async function patchItem(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const before = state.data?.items.find((i) => i.id === id);
  if (!before) return false;
  replaceItem({ ...before, ...(patch as Partial<Item>) });
  try {
    const { item } = await call<{ item: Item }>("PATCH", `/api/items/${id}`, patch);
    replaceItem(item); flash(id); refreshEvents();
    return true;
  } catch (e) {
    replaceItem(before);
    toast((e as Error).message, "error");
    return false;
  }
}

export interface MoveOpts { system_url?: string; note?: string; merged_into?: string; silent?: boolean }

export async function moveItem(id: string, to: Stage, opts: MoveOpts = {}): Promise<boolean> {
  const before = state.data?.items.find((i) => i.id === id);
  if (!before || before.stage === to) return false;
  const t = new Date().toISOString();
  replaceItem({ ...before, stage: to, stage_changed_at: t, live_at: to === "live" ? before.live_at ?? t : before.live_at, system_url: opts.system_url ?? before.system_url });
  try {
    const { item } = await call<{ item: Item }>("POST", `/api/items/${id}/move`, { to, expect: before.stage, ...opts });
    replaceItem(item); flash(id); refreshEvents();
    if (!opts.silent) {
      const canUndo = to !== "live" && to !== "declined" && to !== "retired" && before.stage !== "triage";
      toast(`Moved “${short(item.title)}” to ${stageName(to)}.`, "info", canUndo ? () => moveItem(id, before.stage, { silent: true }) : undefined);
    }
    return true;
  } catch (e) {
    replaceItem(before);
    toast((e as Error).message, "error");
    return false;
  }
}

export async function logResult(id: string, input: Record<string, unknown>): Promise<boolean> {
  try {
    const { entry } = await call<{ entry: ShipLogEntry }>("POST", `/api/items/${id}/log`, input);
    if (state.data) set({ data: { ...state.data, shipLog: [entry, ...state.data.shipLog] } });
    toast("Result logged."); refreshEvents();
    return true;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

const short = (s: string) => (s.length > 40 ? s.slice(0, 38) + "…" : s);
const stageName = (s: Stage) => ({ triage: "Triage", idea: "Idea", building: "Building", live: "Live", declined: "Declined", retired: "Retired" })[s];

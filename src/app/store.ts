/* Client state. One snapshot from GET /api/state, then every change is applied
   locally first (so the screen answers in under 100ms) and reconciled with the
   server's answer. A refused change rolls back and says why. */

import { useSyncExternalStore } from "react";
import type { EventRow, Item, ShipLogEntry, Stage } from "../shared/domain";
import { DEFAULT_ACCENT, accentHover, type Settings } from "../shared/settings";
import type { WorkLink } from "../shared/work";

export interface Snapshot {
  items: Item[];
  shipLog: ShipLogEntry[];
  events: EventRow[];
  workLinks: WorkLink[];
  meta: { demo: boolean; writeKey: boolean; now: string; settings: Settings; photos?: Record<string, string>; space?: "demo" | "real"; user?: { name: string; email: string; picture?: string } | null; signIn?: boolean };
}

export interface Toast { id: number; text: string; tone: "info" | "error"; undo?: () => void; undoKey?: string }

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
export function toast(text: string, tone: Toast["tone"] = "info", undo?: () => void, undoKey?: string) {
  const id = ++toastSeq;
  set({ toasts: [...state.toasts.slice(-2), { id, text, tone, undo, undoKey }] });
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

/* ----------------------------------------------------------------- accent */

/** The accent is one CSS token (--accent) and the text on it (--accent-ink). The default is the stylesheet's own ink, so it needs no override.
    The last accent is kept in this browser so the first paint is already the right colour; the server's answer replaces it. */
const ACCENT_CACHE = "gtm-backlog.accent";
export function applyAccent(hex: string) {
  const root = document.documentElement.style;
  if (hex.toUpperCase() === DEFAULT_ACCENT) { root.removeProperty("--accent"); root.removeProperty("--accent-hover"); root.removeProperty("--accent-ink"); }
  else { root.setProperty("--accent", hex); root.setProperty("--accent-hover", accentHover(hex)); root.setProperty("--accent-ink", "#FFFFFF"); }
  try { localStorage.setItem(ACCENT_CACHE, hex); } catch { /* storage blocked: the next load starts from the stylesheet's colour */ }
}
try { const c = localStorage.getItem(ACCENT_CACHE); if (c && /^#[0-9A-F]{6}$/i.test(c)) applyAccent(c); } catch { /* ignore */ }

/** Saves a setting. The screen changes at once; a refusal puts it back and says why. */
export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<string | null> {
  const before = state.data?.meta.settings;
  if (!state.data || !before) return "The backlog has not loaded yet.";
  const put = (settings: Settings) => { set({ data: { ...state.data!, meta: { ...state.data!.meta, settings } } }); applyAccent(settings.accent); };
  put({ ...before, [key]: value });
  try {
    const res = await call<{ settings: Settings }>("PUT", `/api/settings/${key}`, { value });
    put(res.settings); refreshEvents();
    return null;
  } catch (e) {
    put(before);
    return (e as Error).message;
  }
}

/** Saves, or with null removes, the signed-in person's own photo. Returns a message when it was refused. */
export async function savePhoto(photo: string | null): Promise<string | null> {
  try {
    const res = await call<{ photos: Record<string, string> }>(photo ? "PUT" : "DELETE", "/api/me/photo", photo ? { photo } : undefined);
    if (state.data) set({ data: { ...state.data, meta: { ...state.data.meta, photos: res.photos } } });
    refreshEvents();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export async function load() {
  try {
    const data = await call<Snapshot>("GET", "/api/state");
    applyAccent(data.meta.settings.accent);
    // In the real space the server logs changes under the signed-in name, so the browser never asks for one.
    set({ data, loadError: null, ...(data.meta.space === "real" && data.meta.user ? { actor: data.meta.user.name } : {}) });
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
  const { confirm_score: _c, ...visible } = patch;
  replaceItem({ ...before, ...(visible as Partial<Item>) });
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

export interface MoveOpts { system_url?: string; note?: string; merged_into?: string; silent?: boolean; undoKey?: string }

export async function moveItem(id: string, to: Stage, opts: MoveOpts = {}): Promise<boolean> {
  const before = state.data?.items.find((i) => i.id === id);
  if (!before || before.stage === to) return false;
  const t = new Date().toISOString();
  replaceItem({ ...before, stage: to, stage_changed_at: t, live_at: to === "live" ? before.live_at ?? t : before.live_at, system_url: opts.system_url ?? before.system_url });
  try {
    const { undoKey: _k, silent: _s, ...send } = opts;
    const { item } = await call<{ item: Item }>("POST", `/api/items/${id}/move`, { to, expect: before.stage, ...send });
    replaceItem(item); flash(id); refreshEvents();
    if (!opts.silent) {
      const canUndo = to !== "live" && to !== "declined" && to !== "retired" && before.stage !== "triage";
      toast(`Moved “${short(item.title)}” to ${stageName(to)}.`, "info", canUndo ? () => moveItem(id, before.stage, { silent: true }) : undefined, canUndo ? opts.undoKey : undefined);
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

/* -------------------------------------------------------------- work links */

export async function addLink(itemId: string, input: { url: string; title?: string }): Promise<string | null> {
  try {
    const { link } = await call<{ link: WorkLink }>("POST", `/api/items/${itemId}/links`, input);
    if (state.data) set({ data: { ...state.data, workLinks: [link, ...state.data.workLinks] } });
    refreshEvents();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export async function removeLink(itemId: string, link: WorkLink): Promise<boolean> {
  const before = state.data?.workLinks ?? [];
  if (state.data) set({ data: { ...state.data, workLinks: before.filter((l) => l.id !== link.id) } });
  try {
    await call("DELETE", `/api/items/${itemId}/links/${link.id}`);
    refreshEvents();
    return true;
  } catch (e) {
    if (state.data) set({ data: { ...state.data, workLinks: before } });
    toast((e as Error).message, "error");
    return false;
  }
}

const short = (s: string) => (s.length > 40 ? s.slice(0, 38) + "…" : s);
const stageName = (s: Stage) => ({ triage: "Triage", idea: "Idea", building: "Building", live: "Live", declined: "Declined", retired: "Retired" })[s];

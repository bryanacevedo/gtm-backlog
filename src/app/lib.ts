/* Small shared helpers: routing, formatting. No framework, no dependencies. */

import { useSyncExternalStore } from "react";

/* ----------------------------------------------------------------- router */

export type Route =
  | { view: "queue" | "board" | "triage" | "shipped" }
  | { view: "item"; id: string };

export function parseRoute(path: string): Route {
  const m = path.match(/^\/item\/([\w-]+)/);
  if (m) return { view: "item", id: m[1] };
  if (path.startsWith("/board")) return { view: "board" };
  if (path.startsWith("/triage")) return { view: "triage" };
  if (path.startsWith("/shipped")) return { view: "shipped" };
  return { view: "queue" };
}

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((f) => f()));

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  history[opts.replace ? "replaceState" : "pushState"](null, "", to);
  listeners.forEach((f) => f());
  if (!opts.replace) window.scrollTo({ top: 0 });
}

export function useLocation() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => location.pathname + location.search);
}

export function useQueryParam(key: string): [string | null, (v: string | null) => void] {
  const loc = useLocation();
  const value = new URLSearchParams(loc.split("?")[1] ?? "").get(key);
  const set = (v: string | null) => {
    const p = new URLSearchParams(location.search);
    if (v == null) p.delete(key); else p.set(key, v);
    const qs = p.toString();
    navigate(location.pathname + (qs ? `?${qs}` : ""), { replace: true });
  };
  return [value, set];
}

/** Click handler for <a> that keeps Cmd/Ctrl/middle click opening a new tab. */
export function linkClick(to: string) {
  return (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
}

/* ------------------------------------------------------------- formatting */

const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export const fmtScore = (s: number) => n0.format(s);
export const fmtNum = (v: number) => (Math.abs(v) >= 100 ? n0.format(v) : n1.format(v));

const dShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dLong = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dMonth = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const toDate = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);

export const fmtDay = (iso: string, now = new Date()) =>
  toDate(iso).getUTCFullYear() === now.getUTCFullYear() ? dShort.format(toDate(iso)) : dLong.format(toDate(iso));
export const fmtMonth = (iso: string) => dMonth.format(toDate(iso));

export function daysSince(iso: string, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - toDate(iso).getTime()) / 86_400_000));
}
/** "today", "1 day ago", "12 days ago" */
export function ago(iso: string, now = new Date()) {
  const d = daysSince(iso, now);
  return d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}
/** Compact form for table cells: "3d". */
export const agoShort = (iso: string, now = new Date()) => `${daysSince(iso, now)}d`;

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

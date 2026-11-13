/* The closed component vocabulary. Anything a view needs that is not here
   should be added here once, not invented per page. */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { label, teamsOf, type Stage } from "../shared/domain";
import { fallbackColor, pickPhoto, resolveTeamColors, type TeamColorState } from "../shared/settings";
import { dismiss, useStore } from "./store";

/* ------------------------------------------------------------------ stages */

/* A stage is its word. State is carried by type weight and ink, never by a glyph or a colour (T4):
   Building 500 ink-1, Idea 400 ink-2, Triage, Declined and Retired 400 ink-3, Silent 600 ink-1. */
const stageClass = (stage: Stage, silent: boolean) =>
  silent ? "silent" : stage === "building" ? "st-building" : stage === "idea" ? "st-idea" : stage === "declined" || stage === "retired" || stage === "triage" ? "muted-stage" : "";

export function StageLabel({ stage, silent = false }: { stage: Stage; silent?: boolean }) {
  return <span className={`stage ${stageClass(stage, silent)}`.trim()}>{silent ? "Silent" : label(stage)}</span>;
}

/** The stage word on an item page, which is also the control for the rare moves: pick another stage and the move goes
    through the same checks as everywhere else (a reason or a link first when one is needed). */
export function StageSelect({ stage, silent = false, moves, onMove }: { stage: Stage; silent?: boolean; moves: Stage[]; onMove: (to: Stage) => void }) {
  const id = useId();
  return (
    <span className="stage-pick">
      <label className="sr-only" htmlFor={id}>Stage</label>
      <select id={id} className={`stage-select stage ${stageClass(stage, silent)}`.trim()} value={stage} onChange={(e) => onMove(e.target.value as Stage)}>
        <option value={stage}>{silent ? "Silent" : label(stage)}</option>
        {moves.map((to) => <option key={to} value={to}>{label(to)}</option>)}
      </select>
    </span>
  );
}

/* ------------------------------------------------------------- people, teams */

/* Team colours are identity, not state: a 7px mark beside the team name tells teams apart at a glance (Bryan kept it,
   2026-11-12). Each comes from a validated palette in the settings (shared/settings.ts), never a free hex, and no two teams share one. */
let colorCache: { stored: unknown; teams: string; out: TeamColorState } | null = null;
export function useTeamColors(): TeamColorState {
  const stored = useStore((s) => s.data?.meta.settings.team_colors);
  const items = useStore((s) => s.data?.items);
  const teams = teamsOf(items ?? []);
  const key = teams.join("|");
  if (!colorCache || colorCache.stored !== stored || colorCache.teams !== key) colorCache = { stored, teams: key, out: resolveTeamColors(stored, teams) };
  return colorCache.out;
}
export function useTeamColor(name: string) {
  return useTeamColors().color[name] ?? fallbackColor(name);
}
const PERSON_COLORS = ["#C2410C", "#1D4ED8", "#BE185D", "#0F766E", "#3F3F46", "#B45309", "#15803D", "#9F1239", "#0369A1", "#4D7C0F"];

/* Photos for the fictional sample team, from Unsplash (see CREDITS.md).
   Anyone not listed, including real users, gets initials on a stable color. */
export const PHOTOS: Record<string, string> = {
  "Dana Whitfield": "/avatars/dana-whitfield.jpg",
  "Priya Raman": "/avatars/priya-raman.jpg",
  "Hannah Cole": "/avatars/hannah-cole.jpg",
  "Ava Lindqvist": "/avatars/ava-lindqvist.jpg",
  "Noor Haddad": "/avatars/noor-haddad.jpg",
  "Lena Fischer": "/avatars/lena-fischer.jpg",
  "Sam Ortiz": "/avatars/sam-ortiz.jpg",
  "Marcus Bell": "/avatars/marcus-bell.jpg",
  "Tomás Rivera": "/avatars/tomas-rivera.jpg",
  "Chris Nolan": "/avatars/chris-nolan.jpg",
  "Jordan Pike": "/avatars/jordan-pike.jpg",
};

export function personColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}

/** Precedence: the person's uploaded photo (matched by name), an explicit src, the sample team's photo, the signed-in user's Google photo (matched by name), then initials.
    A photo that fails to load falls back to initials. No name, no avatar: an empty owner is an empty cell, not a shape. */
export function Avatar({ name, size, src }: { name: string | null; size?: "sm" | "lg"; src?: string | null }) {
  const me = useStore((s) => s.data?.meta.user ?? null);
  const uploaded = useStore((s) => s.data?.meta.photos);
  const [failed, setFailed] = useState<string | null>(null);
  if (!name) return null;
  const cls = `av${size ? " " + size : ""}`;
  const photo = pickPhoto(name, { uploaded, src, sample: PHOTOS, me });
  const shown = photo && photo !== failed ? photo : null;
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={cls} style={shown ? undefined : { background: personColor(name) }} title={name} aria-hidden="true">
      {shown ? <img src={shown} alt="" loading="lazy" width={26} height={26} referrerPolicy="no-referrer" onError={() => setFailed(shown)} /> : initials}
    </span>
  );
}

/** The team's colour mark. It identifies, it never signals a state. */
export function TeamMark({ name }: { name: string }) {
  const color = useTeamColor(name);
  // design-lint: allow team identity colour, approved by Bryan
  return <span className="tdot" style={{ background: color }} aria-hidden="true" />;
}

export function Team({ name }: { name: string }) {
  return <><TeamMark name={name} />{name}</>;
}

/* ------------------------------------------------------------------- icons */

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  inbox: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M2 9.5 3.6 3.2a1 1 0 0 1 1-.7h6.8a1 1 0 0 1 1 .7L14 9.5V13a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 13V9.5Z" /><path d="M2 9.5h3.2l.8 1.6h4l.8-1.6H14" /></svg>,
  list: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><circle cx="2.6" cy="4" r=".6" fill="currentColor" /><circle cx="2.6" cy="8" r=".6" fill="currentColor" /><circle cx="2.6" cy="12" r=".6" fill="currentColor" /></svg>,
  board: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><rect x="2" y="2.5" width="3.4" height="11" rx="1" /><rect x="6.3" y="2.5" width="3.4" height="7" rx="1" /><rect x="10.6" y="2.5" width="3.4" height="9" rx="1" /></svg>,
  ship: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M8 2.5v8M4.8 5.7 8 2.5l3.2 3.2" /><path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" /></svg>,
  plus: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>,
  back: () => <svg viewBox="0 0 16 16" {...P} strokeWidth={1.6} aria-hidden="true"><path d="m10 3.5-4.5 4.5 4.5 4.5" /></svg>,
  close: () => <svg viewBox="0 0 16 16" {...P} strokeWidth={1.6} aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>,
  sliders: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M2.5 5h5.2M11.3 5h2.2M2.5 11h2.2M8.3 11h5.2" /><circle cx="9.5" cy="5" r="1.8" /><circle cx="6.5" cy="11" r="1.8" /></svg>,
  external: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5 7.5 8.5" /></svg>,
};

/* ----------------------------------------------------------------- dialog */

export function Dialog({ title, onClose, children, labelledBy, closeButton, focusId, sheet }: { title: string; onClose: () => void; children: ReactNode; labelledBy?: string; closeButton?: boolean; focusId?: string; sheet?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const hid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = (focusId ? ref.current?.querySelector<HTMLElement>(`#${focusId}`) : null) ?? ref.current?.querySelector<HTMLElement>("input, textarea, select, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("input, textarea, select, button, a[href]")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`scrim${sheet ? " sheet" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${sheet ? " sheet" : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? hid} ref={ref}>
        <div className="dialog-head">
          <h2 id={hid}>{title}</h2>
          {closeButton && <button className="btn icon" type="button" aria-label="Close" onClick={onClose}><Icon.close /></button>}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- toasts */

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === "error" ? " error" : ""}`}>
          <span>{t.text}</span>
          {t.undo && <button className="btn text" type="button" onClick={() => { t.undo!(); dismiss(t.id); }}>Undo</button>}
          <button className="btn icon" type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}><Icon.close /></button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- tooltip */

/** One tooltip for the whole app. Opens on hover and on keyboard focus; a tap opens it on a phone and a tap elsewhere closes it;
    Escape closes it. The text is always in the page and tied to the label with aria-describedby, so a screen reader reads it with the label. */
export function Tip({ lines, children }: { lines: readonly string[]; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false), [focus, setFocus] = useState(false), [pin, setPin] = useState(false), [gone, setGone] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const touch = useRef(false);
  const open = !gone && (hover || focus || pin);

  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(264, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    // Below the label, unless it would run off the bottom of the screen.
    setPos(r.bottom + 8 + 150 > window.innerHeight && r.top > 160 ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) { setHover(false); setPin(false); setGone(true); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setGone(true); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key, true); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  return (
    <>
      <button ref={ref} type="button" className="tip" aria-describedby={id}
        onPointerDown={(e) => { touch.current = e.pointerType === "touch"; }}
        onClick={() => { if (touch.current) { setGone(false); setPin((p) => !p); } }}
        onMouseEnter={() => { setGone(false); setHover(true); }} onMouseLeave={() => { setHover(false); setGone(false); }}
        onFocus={() => { setGone(false); setFocus(true); }} onBlur={() => { setFocus(false); setPin(false); setGone(false); }}>
        {children}
      </button>
      {createPortal(
        <span id={id} role="tooltip" className={`tip-bubble${open ? " on" : ""}`} style={pos}>
          {lines.map((l, i) => {
            const row = i > 0 ? l.match(/^(\S+)\s{2}(.*)$/) : null;
            return row ? <span key={i} className="tip-row"><b>{row[1]}</b>{row[2]}</span> : <span key={i} className={i === 0 ? "tip-head" : undefined}>{l}</span>;
          })}
        </span>, document.body)}
    </>
  );
}

/* ------------------------------------------------------------------ empty */

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span>{children}</span>{action}</div>;
}

/* ------------------------------------------------------------------ keys */

export function Keys({ k }: { k: string[] }) {
  return <>{k.map((x) => <kbd key={x}>{x}</kbd>)}</>;
}

/* ------------------------------------------------------- inline editing */

type InlineProps = {
  value: string | number | null;
  display?: ReactNode;
  placeholder: string;
  onSave: (v: string) => Promise<boolean>;
  kind?: "text" | "textarea" | "url" | "number" | "date" | "select";
  options?: readonly string[];
  ariaLabel: string;
  flash?: boolean;
};

/** Click the value, it becomes an input; Enter saves, Esc cancels. No edit mode, no modal. */
export function Inline({ value, display, placeholder, onSave, kind = "text", options, ariaLabel, flash }: InlineProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const start = () => { setDraft(value == null ? "" : String(value)); setEditing(true); };
  const save = async () => {
    if (draft === (value == null ? "" : String(value))) { setEditing(false); return; }
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) setEditing(false);
  };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
    if (e.key === "Enter" && (kind !== "textarea" || e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  };
  if (!editing) {
    return (
      <button type="button" className="editable" data-flash={flash || undefined} onClick={start} aria-label={`Edit ${ariaLabel}`}>
        {value == null || value === "" ? <span className="placeholder">{placeholder}</span> : display ?? String(value)}
      </button>
    );
  }
  const common = { "aria-label": ariaLabel, value: draft, onKeyDown: onKey, autoFocus: true, disabled: busy };
  return (
    <div className="edit-row">
      {kind === "textarea" ? <textarea className="textarea" {...common} onChange={(e) => setDraft(e.target.value)} />
        : kind === "select" ? (
          <select className="select" {...common} onChange={(e) => setDraft(e.target.value)}>
            {options!.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>)
        : <input className="input" {...common} type={kind === "url" ? "url" : kind === "number" ? "number" : kind === "date" ? "date" : "text"}
            inputMode={kind === "number" ? "decimal" : undefined} spellCheck={kind === "url" ? false : undefined} autoComplete="off" onChange={(e) => setDraft(e.target.value)} />}
      <button className="btn primary compact" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"} <kbd>↵</kbd></button>
      <button className="btn quiet compact" type="button" onClick={() => setEditing(false)}>Cancel</button>
    </div>
  );
}

/* The closed component vocabulary. Anything a view needs that is not here
   should be added here once, not invented per page. */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { label, type Stage } from "../shared/domain";
import { dismiss, useStore } from "./store";

/* ------------------------------------------------------------------ marks */

export type MarkKind = Stage | "silent";

/** 10px state glyphs, drawn in currentColor. Shape carries the state; the word confirms it. */
export function Mark({ kind }: { kind: MarkKind }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="mark" viewBox="0 0 10 10" aria-hidden="true">
      {kind === "triage" && <circle cx="5" cy="5" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.9 1.4" />}
      {kind === "idea" && <circle cx="5" cy="5" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.3" />}
      {kind === "building" && (<>
        <circle cx="5" cy="5" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 0.9 A4.1 4.1 0 0 0 5 9.1 Z" fill="currentColor" />
      </>)}
      {kind === "live" && <circle cx="5" cy="5" r="4.75" fill="currentColor" />}
      {kind === "silent" && (<>
        <mask id={`m${id}`}><rect width="10" height="10" fill="#fff" /><circle cx="8.2" cy="1.8" r="2.6" fill="#000" /></mask>
        <circle cx="5" cy="5" r="4.75" fill="currentColor" mask={`url(#m${id})`} />
        <circle cx="8.2" cy="1.8" r="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      </>)}
      {(kind === "declined" || kind === "retired") && (<>
        <clipPath id={`c${id}`}><rect x="1" y="1" width="8" height="8" rx="1" /></clipPath>
        <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
        <g clipPath={`url(#c${id})`} stroke="currentColor" strokeWidth="0.9">
          <path d="M-1 5 L5 -1 M-1 9 L9 -1 M1 11 L11 1 M5 11 L11 5" />
        </g>
      </>)}
    </svg>
  );
}

export function StageLabel({ stage, silent = false }: { stage: Stage; silent?: boolean }) {
  if (silent) return <span className="stage silent"><Mark kind="silent" />Silent</span>;
  const muted = stage === "declined" || stage === "retired" || stage === "triage";
  return <span className={`stage${muted ? " muted-stage" : ""}${stage === "live" ? " live" : ""}`}><Mark kind={stage} />{label(stage)}</span>;
}

/* ------------------------------------------------------------- people, teams */

/* Team colors are identity, not state: a 7px mark beside the team name tells teams apart at a glance (Bryan kept it,
   2026-11-12). design-lint: allow team identity colour, approved by Bryan */
export const TEAM_COLOR: Record<string, string> = {
  Sales: "#2563EB", SDR: "#0E7490", Marketing: "#DB2777", "Field Marketing": "#D97706",
  "Demand Gen": "#EA580C", RevOps: "#0D9488", Partnerships: "#65A30D", "Customer Success": "#B45309",
};
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

export function Avatar({ name, size }: { name: string | null; size?: "sm" | "lg" }) {
  const cls = `av${size ? " " + size : ""}`;
  if (!name) return <span className={`${cls} none`} aria-hidden="true" title="Unassigned" />;
  const photo = PHOTOS[name];
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={cls} style={photo ? undefined : { background: personColor(name) }} title={name} aria-hidden="true">
      {photo ? <img src={photo} alt="" loading="lazy" width={26} height={26} /> : initials}
    </span>
  );
}

export function Team({ name }: { name: string }) {
  // design-lint: allow team identity colour, approved by Bryan
  return <><span className="tdot" style={{ background: TEAM_COLOR[name] ?? "#A1A1AA" }} aria-hidden="true" />{name}</>;
}

/* ------------------------------------------------------------------- icons */

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  inbox: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M2 9.5 3.6 3.2a1 1 0 0 1 1-.7h6.8a1 1 0 0 1 1 .7L14 9.5V13a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 13V9.5Z" /><path d="M2 9.5h3.2l.8 1.6h4l.8-1.6H14" /></svg>,
  list: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><circle cx="2.6" cy="4" r=".6" fill="currentColor" /><circle cx="2.6" cy="8" r=".6" fill="currentColor" /><circle cx="2.6" cy="12" r=".6" fill="currentColor" /></svg>,
  board: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><rect x="2" y="2.5" width="3.4" height="11" rx="1" /><rect x="6.3" y="2.5" width="3.4" height="7" rx="1" /><rect x="10.6" y="2.5" width="3.4" height="9" rx="1" /></svg>,
  ship: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M8 2.5v8M4.8 5.7 8 2.5l3.2 3.2" /><path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" /></svg>,
  plus: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>,
  link: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.6.6M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.6-.6" /></svg>,
  bolt: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M8.8 1.8 3.5 9h4l-.8 5.2L12.5 7h-4Z" /></svg>,
  up: () => <svg viewBox="0 0 16 16" {...P} strokeWidth={1.6} aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>,
  down: () => <svg viewBox="0 0 16 16" {...P} strokeWidth={1.6} aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>,
  back: () => <svg viewBox="0 0 16 16" {...P} strokeWidth={1.6} aria-hidden="true"><path d="m10 3.5-4.5 4.5 4.5 4.5" /></svg>,
  close: () => <svg viewBox="0 0 16 16" {...P} strokeWidth={1.6} aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>,
  external: () => <svg viewBox="0 0 16 16" {...P} aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5 7.5 8.5" /></svg>,
};

/* ----------------------------------------------------------------- dialog */

export function Dialog({ title, sub, onClose, children, labelledBy }: { title: string; sub?: string; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const hid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button");
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
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? hid} ref={ref}>
        <div style={{ display: "grid", gap: 14 }}>
          <h2 id={hid}>{title}</h2>
          {sub && <p className="sub" style={{ margin: 0 }}>{sub}</p>}
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

/* Settings: the accent colour and the team colours, in one place. The team picker also opens from a team's colour mark in the rail. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { teamsOf } from "../shared/domain";
import { ACCENT_SWATCHES, TEAM_PALETTE, accentError, normalizeHex } from "../shared/settings";
import { saveSetting, toast, useStore } from "./store";
import { Dialog, TeamMark, useTeamColors } from "./ui";

/* ------------------------------------------------------------ team colours */

/** Saves one team's new colour: everyone who holds a palette colour keeps theirs, this team takes the new one. */
async function pickTeamColor(team: string, hex: string, held: Record<string, string>) {
  const next: Record<string, string> = {};
  for (const [h, t] of Object.entries(held)) if (t !== team) next[t] = h;
  next[team] = hex;
  const err = await saveSetting("team_colors", next);
  if (err) toast(err, "error");
}

/** The ten colours. Taken ones are hollow and cannot be pressed, the team's own has the ink ring, a count of free ones sits under the grid. */
export function TeamSwatches({ team, onPicked }: { team: string; onPicked?: () => void }) {
  const { holder, free } = useTeamColors();
  const mine = Object.entries(holder).find(([, t]) => t === team)?.[0];
  return (
    <div className="swatch-block">
      <div className="swatches" role="group" aria-label={`${team} colour`}>
        {TEAM_PALETTE.map(({ hex, name }) => {
          const other = holder[hex] && holder[hex] !== team ? holder[hex] : null;
          return (
            // design-lint: allow team identity colour, approved by Bryan
            <button key={hex} type="button" style={{ background: hex, ["--c" as string]: hex }} disabled={!!other} aria-pressed={hex === mine}
              aria-label={other ? `${name}, taken by ${other}` : hex === mine ? `${name}, ${team}'s colour` : `${name}, free`}
              onClick={() => { if (hex !== mine) void pickTeamColor(team, hex, holder); onPicked?.(); }} />
          );
        })}
      </div>
      <span className="pop-foot">{free.length ? `${free.length} free` : mine ? "No free colours" : "No free colour yet. Change another team's first."}</span>
    </div>
  );
}

/** A team's colour mark in the rail; pressing it opens the small grid under it. */
export function TeamMarkButton({ team }: { team: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => { const r = ref.current?.getBoundingClientRect(); if (open && r) setAt({ left: r.left - 8, top: r.bottom + 6 }); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !ref.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); ref.current?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key, true);
    pop.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key, true); };
  }, [open]);
  return (
    <>
      <button ref={ref} type="button" className={`tdot-btn${open ? " on" : ""}`} aria-label={`Change ${team} colour`} aria-expanded={open} onClick={() => setOpen((o) => !o)}><TeamMark name={team} /></button>
      {open && createPortal(
        <div ref={pop} className="pop" role="dialog" aria-label={`${team} colour`} style={at}>
          <span className="pop-head">{team} colour</span>
          <TeamSwatches team={team} onPicked={() => { setOpen(false); ref.current?.focus(); }} />
        </div>, document.body)}
    </>
  );
}

/* ------------------------------------------------------------------ accent */

function AccentPicker() {
  const accent = useStore((s) => s.data!.meta.settings.accent);
  const custom = !ACCENT_SWATCHES.some((s) => s.hex === accent);
  const [draft, setDraft] = useState(custom ? accent : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = /^#?[0-9a-f]{6}$/i.test(draft.trim());
  const live = complete ? accentError(draft) : null;

  const use = async (hex: string) => {
    setBusy(true); setErr(null);
    const bad = await saveSetting("accent", hex);
    setBusy(false);
    if (bad) setErr(bad);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const hex = normalizeHex(draft);
    const bad = accentError(draft);
    if (!hex || bad) { setErr(bad ?? "Use a six-digit colour such as #C2410C."); return; }
    void use(hex);
  };

  return (
    <section className="set-block" aria-labelledby="set-accent">
      <h3 id="set-accent">Accent</h3>
      <div className="swatches big" role="group" aria-label="Accent colour">
        {ACCENT_SWATCHES.map(({ hex, name }) => (
          // design-lint: allow the accent swatches are the choice itself
          <button key={hex} type="button" style={{ background: hex, ["--c" as string]: hex }} aria-pressed={hex === accent} aria-label={name} title={name} onClick={() => { setDraft(""); void use(hex); }} />
        ))}
      </div>
      <form className="hex-row" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="accent-hex">Company colour</label>
          <input id="accent-hex" className="input mono" value={draft} onChange={(e) => { setDraft(e.target.value); setErr(null); }} placeholder="#C2410C" spellCheck={false} autoComplete="off" autoCapitalize="characters" aria-invalid={!!(err || live) || undefined} aria-describedby="accent-hex-msg" />
        </div>
        <button type="submit" className="btn quiet" disabled={busy || !draft.trim()}>Use colour</button>
        <span id="accent-hex-msg" className="error-text hex-msg" role={err || live ? "alert" : undefined}>{err ?? live}</span>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------- sheet */

function TeamColours() {
  const items = useStore((s) => s.data!.items);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="set-block" aria-labelledby="set-teams">
      <h3 id="set-teams">Team colours</h3>
      <div className="team-rows">
        {teamsOf(items).map((t) => (
          <div key={t}>
            <div className="team-row">
              <button type="button" className={`tdot-btn${open === t ? " on" : ""}`} aria-label={`Change ${t} colour`} aria-expanded={open === t} onClick={() => setOpen(open === t ? null : t)}><TeamMark name={t} /></button>
              <span>{t}</span>
            </div>
            {open === t && <div className="team-pick"><TeamSwatches team={t} onPicked={() => setOpen(null)} /></div>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Settings" onClose={onClose} closeButton sheet>
      <div className="settings">
        <AccentPicker />
        <TeamColours />
      </div>
    </Dialog>
  );
}

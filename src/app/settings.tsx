/* Settings: the accent colour and the teams' glyphs, in one place. Every team tile is drawn in the accent, so a team is told apart by its glyph. */

import { useRef, useState } from "react";
import { teamsOf } from "../shared/domain";
import { GLYPHS } from "../shared/glyphs";
import { ACCENT_SWATCHES, accentError, normalizeHex } from "../shared/settings";
import { squareJpeg } from "./photo";
import { savePhoto, saveSetting, toast, useStore } from "./store";
import { Avatar, Dialog, TeamTile, useTeamGlyphs } from "./ui";

/* ------------------------------------------------------------ team glyphs */

/** Saves one team's glyph (an id, or null for the letters): every team that shows a glyph keeps it, this team takes the new one. */
async function pickTeamGlyph(team: string, glyph: string | null, glyphs: Record<string, string | null>) {
  const next: Record<string, string | null> = {};
  for (const [t, g] of Object.entries(glyphs)) if (t !== team) next[t] = g;
  next[team] = glyph;
  const err = await saveSetting("team_glyphs", next);
  if (err) toast(err, "error");
}

/** The sixteen glyphs and the letters, each drawn in the accent. One a team holds is an outline and cannot be pressed; the team's own has the ring. */
export function TeamGlyphs({ team }: { team: string }) {
  const { glyph, holder } = useTeamGlyphs();
  const mine = glyph[team];
  return (
    <div className="swatch-block">
      <div className="shape-set" role="group" aria-label={`${team} glyph`}>
        {GLYPHS.map((g) => {
          const other = holder[g.id] && holder[g.id] !== team ? holder[g.id] : null;
          return (
            <button key={g.id} type="button" disabled={!!other} aria-pressed={g.id === mine} title={g.label}
              aria-label={other ? `${g.label}, taken by ${other}` : g.id === mine ? `${g.label}, ${team}'s glyph` : g.label}
              onClick={() => { if (g.id !== mine) void pickTeamGlyph(team, g.id, glyph); }}>
              <TeamTile name={team} glyph={g.id} />
            </button>
          );
        })}
        <button type="button" aria-pressed={mine === null} title="Letters" aria-label={mine === null ? `Letters, ${team}'s tile` : "Letters"} onClick={() => { if (mine !== null) void pickTeamGlyph(team, null, glyph); }}>
          <TeamTile name={team} glyph={null} />
        </button>
      </div>
    </div>
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
      <div className="swatches" role="group" aria-label="Accent colour">
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

/* ------------------------------------------------------------------- photo */

/** The signed-in person's own photo. Offered only in the real space: the demo has no addresses to keep a photo under. */
function YourPhoto() {
  const me = useStore((s) => s.data!.meta.user);
  const mine = useStore((s) => (me ? s.data!.meta.photos?.[me.name] : undefined));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!me) return null;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try { setErr(await savePhoto(await squareJpeg(file))); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
    if (input.current) input.current.value = "";
  };
  const remove = async () => { setBusy(true); setErr(await savePhoto(null)); setBusy(false); };

  return (
    <section className="set-block" aria-labelledby="set-photo">
      <h3 id="set-photo">Your photo</h3>
      <div className="photo-row">
        <Avatar name={me.name} size="lg" />
        <button type="button" className="btn quiet" disabled={busy} onClick={() => input.current?.click()}>{mine ? "Change photo" : "Choose photo"}</button>
        {mine && <button type="button" className="btn quiet" disabled={busy} onClick={remove}>Remove</button>}
        <input ref={input} className="sr-only" type="file" accept="image/*" tabIndex={-1} aria-label="Photo file" onChange={(e) => void choose(e.target.files?.[0])} />
      </div>
      <span className="error-text" role={err ? "alert" : undefined}>{err}</span>
    </section>
  );
}

/* ------------------------------------------------------------------- sheet */

function TeamGlyphRows() {
  const items = useStore((s) => s.data!.items);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="set-block" aria-labelledby="set-teams">
      <h3 id="set-teams">Teams</h3>
      <div className="team-rows">
        {teamsOf(items).map((t) => (
          <div key={t}>
            <div className="team-row">
              <button type="button" className={`tile-btn${open === t ? " on" : ""}`} aria-label={`Change ${t} glyph`} aria-expanded={open === t} onClick={() => setOpen(open === t ? null : t)}><TeamTile name={t} size="lg" /></button>
              <span>{t}</span>
            </div>
            {open === t && <div className="team-pick"><TeamGlyphs team={t} /></div>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const real = useStore((s) => s.data!.meta.space === "real" && !!s.data!.meta.user);
  return (
    <Dialog title="Settings" onClose={onClose} closeButton sheet>
      <div className="settings">
        {real && <YourPhoto />}
        <AccentPicker />
        <TeamGlyphRows />
      </div>
    </Dialog>
  );
}

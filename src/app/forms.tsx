/* Multi-field forms. Single values are edited inline (ui.tsx Inline); dialogs
   are only for creating something or for a move that needs one more fact. */

import { useState } from "react";
import { TEAMS, TOUCHES, type Item, type Stage } from "../shared/domain";
import { createItem, moveItem, useStore } from "./store";
import { Dialog } from "./ui";

/* ------------------------------------------------------------ new request */

export function NewRequest({ onClose, onCreated }: { onClose: () => void; onCreated: (item: Item) => void }) {
  const actor = useStore((s) => s.actor);
  const [f, setF] = useState({ title: "", problem: "", team: "", requester: actor ?? "", link: "", touches: [] as string[] });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = !f.title.trim() ? "title" : !f.problem.trim() ? "problem" : !f.team ? "team" : !f.requester.trim() ? "requester" : null;
    if (missing) {
      setErr({ field: missing, msg: { title: "Give the request a title.", problem: "Describe the problem in a sentence or two.", team: "Pick the team that is asking.", requester: "Say who is asking." }[missing] });
      document.getElementById(`nr-${missing}`)?.focus();
      return;
    }
    setBusy(true); setErr(null);
    try {
      const item = await createItem({ ...f, link: f.link.trim() || null });
      if (item) onCreated(item);
    } catch (e2) {
      setErr({ msg: (e2 as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Dialog title="New request" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 16 }} noValidate>
        <div className="field">
          <label htmlFor="nr-title">Request</label>
          <input id="nr-title" name="title" className="input" value={f.title} onChange={set("title")} placeholder="Alert reps when a target account visits pricing…" autoComplete="off" aria-invalid={err?.field === "title" || undefined} />
        </div>
        <div className="field">
          <label htmlFor="nr-problem">Problem</label>
          <textarea id="nr-problem" name="problem" className="textarea" value={f.problem} onChange={set("problem")} placeholder="What happens today and what it costs" aria-invalid={err?.field === "problem" || undefined} />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="nr-team">Team</label>
            <select id="nr-team" name="team" className="select" value={f.team} onChange={set("team")} aria-invalid={err?.field === "team" || undefined}>
              <option value="" disabled>Choose a team</option>
              {TEAMS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nr-requester">Requested by</label>
            <input id="nr-requester" name="requester" className="input" value={f.requester} onChange={set("requester")} autoComplete="name" aria-invalid={err?.field === "requester" || undefined} />
          </div>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>Touches</legend>
          <div className="checks">
            {TOUCHES.map((t) => (
              <label key={t} className="check">
                <input type="checkbox" checked={f.touches.includes(t)} onChange={(e) => setF({ ...f, touches: e.target.checked ? [...f.touches, t] : f.touches.filter((x) => x !== t) })} />
                {t[0].toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="nr-link">Link (optional)</label>
          <input id="nr-link" name="link" className="input" type="url" inputMode="url" spellCheck={false} value={f.link} onChange={set("link")} placeholder="Slack thread or doc URL" autoComplete="off" />
        </div>
        {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err.msg}</p>}
        <div className="dialog-foot">
          <button type="button" className="btn quiet" onClick={onClose}>Cancel <kbd>Esc</kbd></button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Submitting…" : "Submit request"}</button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------- moves that need a fact */

export type PendingMove = { item: Item; to: Stage; mode: "link" | "reason" | "decline"; focus?: "target" };

export function MoveDialog({ pending, onClose }: { pending: PendingMove; onClose: () => void }) {
  const { item, to, mode } = pending;
  const items = useStore((s) => s.data?.items ?? []);
  const [value, setValue] = useState(mode === "link" ? item.system_url ?? "" : "");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = items.filter((i) => i.id !== item.id && ["idea", "building", "live"].includes(i.stage)).sort((a, b) => a.title.localeCompare(b.title));

  const copy = mode === "link"
    ? { title: "Mark it live", cta: "Mark live", label: "System link (repo, workflow or dashboard)" }
    : mode === "decline"
      ? { title: "Decline this request", cta: target ? "Merge request" : "Decline request", label: target ? "Note for the requester (optional)" : "Reason (the requester sees this)" }
      : { title: "Retire this system", cta: "Retire system", label: "Reason (what replaced it, or why it stopped)" };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "link" && !/^https?:\/\/\S+$/.test(value.trim())) { setErr("Paste a link that starts with https://"); return; }
    if (mode !== "link" && !target && !value.trim()) { setErr("Write the reason; the requester will read it."); return; }
    setBusy(true);
    const ok = await moveItem(item.id, to, mode === "link" ? { system_url: value.trim() } : target ? { merged_into: target, note: value.trim() || undefined } : { note: value.trim() });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog title={copy.title} onClose={onClose} focusId={mode === "decline" && pending.focus !== "target" ? "mv-value" : undefined}>
      <form onSubmit={submit} style={{ display: "grid", gap: 16 }} noValidate>
        {mode === "decline" && (
          <div className="field">
            <label htmlFor="mv-target">Covered by another item (optional)</label>
            <select id="mv-target" className="select" value={target} onChange={(e) => { setTarget(e.target.value); setErr(null); }}>
              <option value="">None</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="mv-value">{copy.label}</label>
          {mode === "link"
            ? <input id="mv-value" className="input" type="url" inputMode="url" spellCheck={false} autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://github.com/…" aria-invalid={!!err || undefined} />
            : <textarea id="mv-value" className="textarea" value={value} onChange={(e) => setValue(e.target.value)} placeholder={target ? "Anything they should know…" : "Too broad to build as one item; the duplicate merge job covers…"} aria-invalid={!!err || undefined} />}
        </div>
        {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="dialog-foot">
          <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : copy.cta}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Decides whether a move can go straight through or needs a dialog first. */
export function planMove(item: Item, to: Stage): PendingMove | null {
  if (to === "live" && !item.system_url) return { item, to, mode: "link" };
  if (to === "declined") return { item, to, mode: "decline" };
  if (to === "retired") return { item, to, mode: "reason" };
  return null;
}


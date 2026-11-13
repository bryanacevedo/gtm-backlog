/* Triage as an inbox: requests on the left, the decision on the right, and a live
   preview of where the request lands in the queue before anyone accepts it. */

import { useEffect, useMemo, useRef, useState } from "react";
import { CONFIDENCE, IMPACT_RUBRIC, OPEN, rank, score, type Item } from "../../shared/domain";
import type { Shared } from "../App";
import { ago, agoShort, fmtScore, isTyping, linkClick } from "../lib";
import { moveItem, patchItem, toast, useStore } from "../store";
import { Avatar, Icon, Team } from "../ui";

type Draft = { impact: number; reach: number; confidence: number; effort_days: number };
const DEFAULTS: Draft = { impact: 3, reach: 25, confidence: 80, effort_days: 3 };
const draftOf = (i: Item): Draft => ({
  impact: i.impact ?? DEFAULTS.impact, reach: i.reach ?? DEFAULTS.reach,
  confidence: i.confidence ?? DEFAULTS.confidence, effort_days: i.effort_days ?? DEFAULTS.effort_days,
});

export function Triage({ shared }: { shared: Shared }) {
  const data = useStore((s) => s.data)!;
  const [tab, setTab] = useState<"waiting" | "declined">("waiting");
  const waiting = useMemo(() => data.items.filter((i) => i.stage === "triage").sort((a, b) => a.created_at.localeCompare(b.created_at)), [data.items]);
  const declined = useMemo(() => data.items.filter((i) => i.stage === "declined").sort((a, b) => b.stage_changed_at.localeCompare(a.stage_changed_at)), [data.items]);
  const list = tab === "waiting" ? waiting : declined;
  const [selId, setSelId] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // phone: list or decision
  const [leaving, setLeaving] = useState<string | null>(null);
  const sel = list.find((i) => i.id === selId) ?? list[0] ?? null;
  const seen = useRef(new Set<string>());

  useEffect(() => { if (sel) seen.current.add(sel.id); }, [sel]);

  const step = (d: number) => {
    if (!list.length) return;
    const i = sel ? list.indexOf(sel) : -1;
    const next = list[Math.max(0, Math.min(list.length - 1, i + d))];
    setSelId(next.id);
    requestAnimationFrame(() => document.querySelector(`[data-req="${next.id}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  const accept = async (item: Item, draft: Draft) => {
    const where = placement(data.items, item, draft).pos;
    setLeaving(item.id);
    const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => item[k] !== draft[k]);
    const ok = (changed ? await patchItem(item.id, draft) : true) && await moveItem(item.id, "idea", { silent: true });
    setLeaving(null);
    if (!ok) return;
    const i = waiting.indexOf(item);
    const next = waiting[i + 1] ?? waiting[i - 1];
    setSelId(next?.id ?? null);
    toast(`Accepted. “${short(item.title)}” is #${where} in the queue.`, "info", () => moveItem(item.id, "triage", { silent: true }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".scrim")) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
      else if (sel && tab === "waiting" && e.key === "m") { e.preventDefault(); shared.requestMove({ item: sel, to: "declined", mode: "merge" }); }
      else if (sel && tab === "waiting" && e.key === "d") { e.preventDefault(); shared.requestMove({ item: sel, to: "declined", mode: "reason" }); }
      else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="inbox" data-open={open || undefined}>
      <section className="inbox-list" aria-label="Requests">
        <div className="inbox-head">
          <h1>Triage</h1><span className="count">{waiting.length}</span>
          <div className="tabs" role="tablist" aria-label="Show">
            <button className="tab" role="tab" type="button" aria-selected={tab === "waiting"} onClick={() => { setTab("waiting"); setSelId(null); }}>Waiting</button>
            <button className="tab" role="tab" type="button" aria-selected={tab === "declined"} onClick={() => { setTab("declined"); setSelId(null); }}>Declined <span className="n">{declined.length}</span></button>
          </div>
        </div>
        <div className="reqs" role="listbox" aria-label={tab === "waiting" ? "Waiting requests" : "Declined requests"}>
          {list.length === 0 ? (
            <div className="inbox-empty">
              <span>{tab === "waiting" ? "Every request has an answer. New ones from the form or Slack land here." : "Nothing has been declined."}</span>
              {tab === "waiting" && <button className="btn quiet compact" type="button" onClick={shared.openNew}>New request</button>}
            </div>
          ) : list.map((r) => (
            <button key={r.id} type="button" className={`req${leaving === r.id ? " leaving" : ""}${tab === "declined" ? " closed" : ""}${tab === "waiting" ? (seen.current.has(r.id) ? " seen" : " unseen") : ""}`} role="option" data-req={r.id}
              aria-selected={sel?.id === r.id} onClick={() => { setSelId(r.id); setOpen(true); }}>
              <Avatar name={r.requester} />
              <span className="t">{r.title}{tab === "waiting" && !seen.current.has(r.id) && <span className="sr-only"> (not opened yet)</span>}</span>
              <span className="age">{agoShort(tab === "waiting" ? r.created_at : r.stage_changed_at)}</span>
              <span className="meta">{r.requester} · <Team name={r.team} /></span>
            </button>
          ))}
        </div>
        <div className="inbox-foot"><kbd>J</kbd><kbd>K</kbd> to move through requests</div>
      </section>

      <section className="decision" aria-label="Decision">
        {sel ? <Decision key={sel.id} item={sel} items={data.items} declinedView={tab === "declined"} shared={shared} onAccept={accept} onBack={() => setOpen(false)} onStep={step} />
          : <div className="decision-body"><p className="hint">{tab === "waiting" ? "Nothing to decide." : "Pick a request to see why it was declined."}</p></div>}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ decision */

function Decision({ item, items, declinedView, shared, onAccept, onBack, onStep }: {
  item: Item; items: Item[]; declinedView: boolean; shared: Shared;
  onAccept: (i: Item, d: Draft) => void; onBack: () => void; onStep: (d: number) => void;
}) {
  const [draft, setDraft] = useState<Draft>(draftOf(item));
  const [busy, setBusy] = useState(false);
  const { pos, rows } = placement(items, item, draft);
  const s = score(draft)!;
  const merged = item.merged_into ? items.find((i) => i.id === item.merged_into) : null;

  useEffect(() => {
    if (declinedView) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".scrim")) return;
      if (e.key === "a" && !busy) { e.preventDefault(); go(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const go = async () => { setBusy(true); await onAccept(item, draft); setBusy(false); };

  return (
    <>
      <div className="decision-head">
        <button className="btn icon phone-only" type="button" aria-label="Back to requests" onClick={onBack}><Icon.back /></button>
        <span>{item.id.replace(/^bl_/, "REQ-").toUpperCase()}</span><span aria-hidden="true">·</span><Team name={item.team} />
        <div className="sp">
          <button className="btn icon" type="button" aria-label="Previous request" onClick={() => onStep(-1)}><Icon.up /></button>
          <button className="btn icon" type="button" aria-label="Next request" onClick={() => onStep(1)}><Icon.down /></button>
        </div>
      </div>
      <div className="decision-body swap">
        <div className="who"><Avatar name={item.requester} size="sm" /><b>{item.requester}</b><span>requested {ago(item.created_at)}</span></div>
        <h2><a href={`/item/${item.id}`} onClick={linkClick(`/item/${item.id}`)}>{item.title}</a></h2>
        <p className="problem">{item.problem}</p>
        <div className="facts">
          {item.touches.length > 0 && <span><Icon.bolt />Touches {item.touches.join(", ")}</span>}
          {item.link && <a href={item.link} target="_blank" rel="noreferrer"><Icon.link />Source thread</a>}
        </div>

        {declinedView ? (
          <div className="decided">
            <span><b style={{ color: "var(--ink-1)", fontWeight: 600 }}>{merged ? "Merged" : "Declined"} {ago(item.stage_changed_at)}.</b> {item.decision_note}</span>
            {merged && <a className="link" href={`/item/${merged.id}`} onClick={linkClick(`/item/${merged.id}`)}>Open “{merged.title}”</a>}
          </div>
        ) : (
          <div className="decide">
            <div className="decide-inputs">
              <Steps label="Impact" n={5} value={draft.impact} onChange={(v) => setDraft({ ...draft, impact: v })} show={`${draft.impact} of 5`} titleFor={(n) => IMPACT_RUBRIC[n]} />
              <Slider label="Reach" min={0} max={500} step={5} value={draft.reach} onChange={(v) => setDraft({ ...draft, reach: v })} show={`${draft.reach}/wk`} />
              <Steps label="Confidence" n={3} value={CONFIDENCE.indexOf(draft.confidence as 50 | 80 | 100) + 1} onChange={(v) => setDraft({ ...draft, confidence: CONFIDENCE[v - 1] })} show={`${draft.confidence}%`} titleFor={(n) => `${CONFIDENCE[n - 1]}%`} />
              <Slider label="Effort" min={0.5} max={30} step={0.5} value={draft.effort_days} onChange={(v) => setDraft({ ...draft, effort_days: v })} show={`${draft.effort_days} ${draft.effort_days === 1 ? "day" : "days"}`} />
              <p className="hint">{IMPACT_RUBRIC[draft.impact]}. Reach counts accounts per week.</p>
            </div>
            <div className="decide-rank" aria-live="polite">
              <span className="hint">Lands in the queue at</span>
              <div className="big"><Tick value={`#${pos}`} /><span>score {fmtScore(s)}</span></div>
              <Mini rows={rows} pos={pos} selfId={item.id} />
            </div>
          </div>
        )}
      </div>
      <div className="decision-actions">
        {declinedView ? (
          <button className="btn quiet" type="button" onClick={() => moveItem(item.id, "triage")}>Reopen request</button>
        ) : (<>
          <button className="btn primary" type="button" onClick={go} disabled={busy}>{busy ? "Accepting…" : "Accept"} <kbd>A</kbd></button>
          <button className="btn quiet" type="button" onClick={() => shared.requestMove({ item, to: "declined", mode: "merge" })}>Merge <kbd>M</kbd></button>
          <button className="btn text" type="button" onClick={() => shared.requestMove({ item, to: "declined", mode: "reason" })}>Decline <kbd>D</kbd></button>
          <span className="hint">Accepting moves it to Idea at #{pos}</span>
        </>)}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- placement */

type Row = { id: string; title: string; score: number | null };
function placement(items: Item[], self: Item, d: Draft): { pos: number; rows: Row[] } {
  const others = items.filter((i) => OPEN.includes(i.stage) && i.id !== self.id);
  const ranked = rank([...others, { ...self, ...d, stage: "idea" } as Item]);
  return { pos: ranked.findIndex((i) => i.id === self.id) + 1, rows: ranked.map((i) => ({ id: i.id, title: i.title, score: score(i) })) };
}

/* Five rows around the request; rows glide to their new place when the rank changes. */
function Mini({ rows, pos, selfId }: { rows: Row[]; pos: number; selfId: string }) {
  const start = Math.max(0, Math.min(pos - 3, rows.length - 5));
  return (
    <div className="mini" style={{ height: Math.min(5, rows.length) * 30 }}>
      {rows.map((r, i) => {
        const k = i - start;
        const visible = k >= 0 && k < 5;
        return (
          <div key={r.id} className={r.id === selfId ? "mine" : undefined} aria-hidden={!visible || undefined}
            style={{ transform: `translateY(${Math.max(-1, Math.min(5, k)) * 30}px)`, opacity: visible ? 1 : 0 }}>
            <span>{i + 1}</span><span>{r.title}</span><span>{r.score == null ? "–" : fmtScore(r.score)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Tick({ value }: { value: string }) {
  const [k, setK] = useState(0);
  const prev = useRef(value);
  useEffect(() => { if (prev.current !== value) { prev.current = value; setK((x) => x + 1); } }, [value]);
  return <b key={k} className={k ? "tick" : undefined}>{value}</b>;
}

export function Steps({ label, n, value, onChange, show, titleFor }: { label: string; n: number; value: number; onChange: (v: number) => void; show: string; titleFor: (n: number) => string }) {
  const id = `st-${label.toLowerCase()}`;
  return (
    <div className="in-row">
      <span className="lab" id={id}>{label}</span>
      <span className="steps" role="group" aria-labelledby={id}>
        {Array.from({ length: n }, (_, i) => i + 1).map((v) => (
          <button key={v} type="button" className={v <= value ? "f" : undefined} aria-pressed={v === value} aria-label={`${label} ${titleFor(v)}`} title={titleFor(v)} onClick={() => onChange(v)}><i /></button>
        ))}
      </span>
      <span className="val">{show}</span>
    </div>
  );
}

export function Slider({ label, min, max, step, value, onChange, show }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; show: string }) {
  const id = `sl-${label.toLowerCase()}`;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="in-row">
      <label className="lab" htmlFor={id}>{label}</label>
      <input id={id} className="range" type="range" min={min} max={max} step={step} value={value} style={{ ["--p" as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{show}</span>
    </div>
  );
}

const short = (s: string) => (s.length > 34 ? s.slice(0, 32) + "…" : s);

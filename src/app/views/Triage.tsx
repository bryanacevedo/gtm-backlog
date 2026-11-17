/* Triage as an inbox: requests on the left, the decision on the right, and a live
   preview of where the request lands in the queue before anyone accepts it. */

import { useEffect, useMemo, useRef, useState } from "react";
import { OPEN, rank, score, type Item } from "../../shared/domain";
import { scoresUpdatedLine } from "../../shared/scores-updated";
import { FIELD_WORD, SCORE_FIELDS, TRUST_MIN, trustOf, type Proposal, type ScoreField } from "../../shared/scoring";
import type { Shared } from "../App";
import { ago, agoShort, fmtScore, isTyping, linkClick } from "../lib";
import { ensureProposal, loadProposals, moveItem, patchItem, toast, useStore } from "../store";
import { ScoreInputs, type Draft } from "../score-inputs";
import { DEMO_SAVE_LINE } from "../../shared/words";
import { Avatar, Icon, Team } from "../ui";

const DEFAULTS: Draft = { impact: 3, reach: 25, confidence: 80, effort_days: 3 };
/** What the inputs start at: the request's own values, else the proposal, else the plain starting values. */
const draftOf = (i: Item, p?: Proposal | null): Draft => ({
  impact: i.impact ?? p?.impact ?? DEFAULTS.impact, reach: i.reach ?? p?.reach ?? DEFAULTS.reach,
  confidence: i.confidence ?? p?.confidence ?? DEFAULTS.confidence, effort_days: i.effort_days ?? p?.effort_days ?? DEFAULTS.effort_days,
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
  useEffect(() => { void loadProposals(); }, []);

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
    void loadProposals();
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
      else if (sel && tab === "waiting" && e.key === "m") { e.preventDefault(); shared.requestMove({ item: sel, to: "declined", mode: "decline", focus: "target" }); }
      else if (sel && tab === "waiting" && e.key === "d") { e.preventDefault(); shared.requestMove({ item: sel, to: "declined", mode: "decline" }); }
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
              <span>{tab === "waiting" ? "No requests waiting." : "Nothing has been declined."}</span>
              {tab === "waiting" && <button className="btn primary compact" type="button" onClick={shared.openNew}>New request</button>}
            </div>
          ) : list.map((r) => (
            <button key={r.id} type="button" className={`req${leaving === r.id ? " leaving" : ""}${tab === "declined" ? " closed" : ""}${tab === "waiting" ? (seen.current.has(r.id) ? " seen" : " unseen") : ""}`} role="option" data-req={r.id}
              aria-selected={sel?.id === r.id} onClick={() => { setSelId(r.id); setOpen(true); }}>
              <Avatar name={r.requester} />
              <span className="t">{r.title}{tab === "waiting" && !seen.current.has(r.id) && <span className="sr-only"> (not opened yet)</span>}</span>
              <span className="age">{agoShort(tab === "waiting" ? r.created_at : r.stage_changed_at)}</span>
              <span className="meta">{r.requester} <Team name={r.team} /></span>
            </button>
          ))}
        </div>
        <div className="inbox-foot"><kbd>J</kbd><kbd>K</kbd> move <kbd>A</kbd> accept <kbd>M</kbd> merge <kbd>D</kbd> decline</div>
      </section>

      <section className="decision" aria-label="Decision">
        {sel ? <Decision key={sel.id} item={sel} items={data.items} declinedView={tab === "declined"} shared={shared} onAccept={accept} onBack={() => setOpen(false)} />
          : <div className="decision-body"><p className="hint">{tab === "waiting" ? "Nothing to decide." : "Nothing declined."}</p></div>}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ decision */

function Decision({ item, items, declinedView, shared, onAccept, onBack }: {
  item: Item; items: Item[]; declinedView: boolean; shared: Shared;
  onAccept: (i: Item, d: Draft) => void; onBack: () => void;
}) {
  const proposal = useStore((st) => st.proposals.list.find((p) => p.item_id === item.id && !p.resolved_at) ?? null);
  const pending = useStore((st) => st.proposals.pending.includes(item.id));
  const unavailable = useStore((st) => st.proposals.unavailable[item.id]);
  const [draft, setDraft] = useState<Draft>(draftOf(item, proposal));
  const [bad, setBad] = useState<ScoreField[]>([]);
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  const [updated, setUpdated] = useState<string | null>(null);
  const demo = useStore((st) => st.data?.meta.demo);
  // A proposal that lands after the request was opened fills the inputs, unless someone has already changed one.
  useEffect(() => { if (!declinedView) void ensureProposal(item.id); }, [item.id, declinedView]);
  useEffect(() => {
    if (touched.current) return;
    const next = draftOf(item, proposal);
    // The proposal replaced the starting values: say so, with the rank before and after, instead of moving the preview in silence.
    if (proposal && !declinedView) setUpdated(scoresUpdatedLine(draft, next, placement(items, item, draft).pos, placement(items, item, next).pos, proposal.source === "stand-in" ? "A sample proposal" : proposal.model));
    setDraft(next);
  }, [proposal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { pos, rows } = placement(items, item, draft);
  const s = score(draft)!;
  const merged = item.merged_into ? items.find((i) => i.id === item.merged_into) : null;

  useEffect(() => {
    if (declinedView) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".scrim")) return;
      if (e.key !== "a") return;
      e.preventDefault();
      if (busy) return;
      if (bad.length) { toast("Not accepted yet: fix the value marked in red first.", "info"); return; }
      go();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const go = async () => { setBusy(true); await onAccept(item, draft); setBusy(false); };

  return (
    <>
      <div className="decision-head">
        <button className="btn icon phone-only" type="button" aria-label="Back to requests" onClick={onBack}><Icon.back /></button>
        <Team name={item.team} />
      </div>
      <div className="decision-body swap">
        <div className="who"><Avatar name={item.requester} size="sm" /><b>{item.requester}</b><span>requested {ago(item.created_at)}</span></div>
        <h2><a href={`/item/${item.id}`} onClick={linkClick(`/item/${item.id}`)}>{item.title}</a></h2>
        <p className="problem">{item.problem}</p>
        <div className="facts">
          {item.touches.length > 0 && <span>Touches {item.touches.join(", ")}</span>}
          {item.link && <a className="btn icon" href={item.link} target="_blank" rel="noreferrer" aria-label="Open the source thread" title="Open the source thread"><Icon.external /></a>}
        </div>

        {declinedView ? (
          <div className="decided">
            <span><b>{merged ? "Merged" : "Declined"} {ago(item.stage_changed_at)}.</b> {item.decision_note}</span>
            {merged && <a className="btn quiet compact" href={`/item/${merged.id}`} onClick={linkClick(`/item/${merged.id}`)}>Open item</a>}
          </div>
        ) : (
          <div className="decide">
            <div className="decide-inputs">
              <div className="prop-line hint" aria-live="polite">{proposalLine(proposal, pending, unavailable)}</div>
              {/* The live region is always in the page, empty, and is filled later, so screen readers announce the change. */}
              <div role="status" className="scores-live">{updated && <div className="scores-updated">{updated} <button className="btn text compact" type="button" onClick={() => setUpdated(null)}>Dismiss</button></div>}</div>
              <ScoreInputs value={draft} proposal={proposal} onChange={(d) => { touched.current = true; setDraft(d); }} onValid={(f, ok) => setBad((x) => (ok ? x.filter((y) => y !== f) : x.includes(f) ? x : [...x, f]))} />
            </div>
            <div className="decide-rank" aria-live="polite">
              <span className="hint">Lands in the queue at</span>
              <div className="big"><Tick value={`#${pos}`} /><span>score {fmtScore(s)}</span></div>
              <Mini rows={rows} pos={pos} selfId={item.id} />
            </div>
          </div>
        )}
        {!declinedView && <TrustReport />}
      </div>
      <div className="decision-actions">
        {declinedView ? (
          <button className="btn primary" type="button" onClick={() => moveItem(item.id, "triage")}>Reopen request</button>
        ) : (<>
          <button className="btn primary" type="button" onClick={go} disabled={busy || bad.length > 0} aria-keyshortcuts="A" title="Accept: moves the request into the ranked queue. Shortcut A. You can undo it.">{busy ? "Accepting…" : "Accept"} <kbd>A</kbd></button>
          <button className="btn quiet" type="button" onClick={() => shared.requestMove({ item, to: "declined", mode: "decline" })} aria-keyshortcuts="D" title="Decline: asks for a reason before it closes the request. Shortcut D.">Decline <kbd>D</kbd></button>
          {demo && <span className="act-line">{DEMO_SAVE_LINE}</span>}
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

/** One plain line about where the inputs came from. */
function proposalLine(p: Proposal | null, pending: boolean, unavailable?: string) {
  if (p) {
    const guesses = p.guesses.length;
    return p.source === "stand-in"
      ? "Sample proposal. The demo makes no live call."
      : `Proposed by ${p.model}${p.examples_used ? `, using ${p.examples_used} of your past decisions` : ", before any of your decisions to learn from"}${guesses ? `. ${guesses === 1 ? "One value is a guess" : `${guesses} values are guesses`}.` : "."}`;
  }
  if (pending) return "Proposing scores…";
  if (unavailable) return `${unavailable} These are starting values, not proposals.`;
  return "";
}

/* How far the proposals have been trusted: the share accepted unchanged and the drift per input, as the Shipped screen lays out its figures. */
function TrustReport() {
  const list = useStore((s) => s.proposals.list);
  const loaded = useStore((s) => s.proposals.loaded);
  const t = useMemo(() => trustOf(list), [list]);
  if (!loaded) return null;
  if (t.decided < TRUST_MIN) return <div className="trust"><div className="meters"><div className="meter"><span className="label">Proposal accuracy, decisions so far</span><span className="fig">{t.decided}<span className="unit"> of {TRUST_MIN}</span></span></div></div><p className="legend">{DRIFT_LEGEND}</p></div>;
  const unit = (f: ScoreField) => (t.drift[f].unit === "points" ? ` ${f === "confidence" ? "pts" : "pt"}` : "%");
  return (
    <div className="trust"><div className="meters" role="group" aria-label="How the proposals have held up">
      <div className="meter"><span className="label">Accepted unchanged</span><span className="fig">{Math.round((t.unchanged / t.decided) * 100)}<span className="unit">%</span></span><span className="note">{t.unchanged} of {t.decided}</span></div>
      {SCORE_FIELDS.map((f) => (
        <div className="meter" key={f}><span className="label">{FIELD_WORD[f]} drift</span><span className="fig">±{t.drift[f].mean < 10 ? t.drift[f].mean.toFixed(1) : Math.round(t.drift[f].mean)}<span className="unit">{unit(f)}</span></span><span className="note">{t.drift[f].changed} changed</span></div>
      ))}
    </div><p className="legend">{DRIFT_LEGEND}</p></div>
  );
}

const DRIFT_LEGEND = "Drift is how far a proposed value was from the value a person accepted, on average. An AI model proposes the scores; a person decides.";
const short = (s: string) => (s.length > 34 ? s.slice(0, 32) + "…" : s);

import { useEffect, useState } from "react";
import { CONFIDENCE, FLOW, IMPACT_RUBRIC, TEAMS, canMove, isScoreStale, isSilent, label, score, type Item, type ShipLogEntry, type Stage } from "../../shared/domain";
import type { Shared } from "../App";
import { planMove } from "../forms";
import { ago, daysSince, fmtDay, fmtNum, fmtScore, isTyping, linkClick, navigate } from "../lib";
import { logResult, moveItem, patchItem, useStore } from "../store";
import { Avatar, Empty, Inline, StageLabel, Team } from "../ui";
import { Slider, Steps } from "./Triage";

const MOVE_LABEL: Partial<Record<Stage, string>> = { idea: "Back to idea", building: "Start building", live: "Mark live", declined: "Decline", retired: "Retire", triage: "Back to triage" };

export function ItemPage({ id, shared }: { id: string; shared: Shared }) {
  const data = useStore((s) => s.data)!;
  const flash = useStore((s) => s.flash);
  const item = data.items.find((i) => i.id === id);
  const now = new Date();

  const go = (to: Stage) => {
    if (!item) return;
    const p = planMove(item, to);
    if (p) shared.requestMove(p); else moveItem(item.id, to);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".scrim") || !item) return;
      if (e.key === "Escape") { e.preventDefault(); history.length > 1 ? history.back() : navigate("/"); }
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && FLOW.includes(item.stage)) {
        const to = FLOW[FLOW.indexOf(item.stage) + (e.key === "ArrowRight" ? 1 : -1)];
        if (to) { e.preventDefault(); go(to); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!item) return <Empty action={<a className="btn quiet compact" href="/" onClick={linkClick("/")}>Back to the queue</a>}>This item does not exist, or the link is mistyped.</Empty>;

  const log = data.shipLog.filter((l) => l.item_id === item.id);
  const events = data.events.filter((e) => e.item_id === item.id);
  const silent = isSilent(item, log, now);
  const merged = item.merged_into ? data.items.find((i) => i.id === item.merged_into) : null;
  const moves = (["triage", "idea", "building", "live", "declined", "retired"] as Stage[]).filter((s) => canMove(item.stage, s));
  const forward = moves.find((s) => FLOW.includes(s) && FLOW.indexOf(s) > FLOW.indexOf(item.stage));
  const save = (field: string) => (v: string) => patchItem(item.id, { [field]: v === "" ? null : v });
  const back = item.stage === "triage" || item.stage === "declined" ? "/triage" : item.live_at ? "/shipped" : "/";
  const backName = back === "/triage" ? "Triage" : back === "/shipped" ? "Shipped" : "Queue";

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href={back} onClick={linkClick(back)}>{backName}</a><span aria-hidden="true">/</span><span>{item.id.replace(/^bl_/, "REQ-").toUpperCase()}</span>
      </nav>

      <header className="item-head">
        <h1><Inline value={item.title} placeholder="Untitled" ariaLabel="title" onSave={save("title")} flash={flash === item.id} /></h1>
        <div className="move-bar">
          <StageLabel stage={item.stage} silent={silent} />
          <span className="since">since {fmtDay(item.stage_changed_at, now)}</span>
          {moves.map((to) => (
            <button key={to} type="button" onClick={() => go(to)}
              className={to === forward ? "btn primary compact" : to === "declined" || to === "retired" ? "btn text danger compact" : "btn quiet compact"}>
              {to === "building" && item.stage === "live" ? "Back to building" : MOVE_LABEL[to] ?? label(to)}
            </button>
          ))}
        </div>
        {item.decision_note && (item.stage === "declined" || item.stage === "retired") && (
          <div className="decision-note">
            <b>{item.stage === "declined" ? (merged ? "Merged" : "Declined") : "Retired"}.</b> {item.decision_note}
            {merged && <> <a className="link" href={`/item/${merged.id}`} onClick={linkClick(`/item/${merged.id}`)}>Open “{merged.title}”</a></>}
          </div>
        )}
      </header>

      <div className="item-cols">
        <div style={{ display: "grid", gap: 28, minWidth: 0 }}>
          <ScoreSection item={item} now={now} />
          <section className="sect" aria-labelledby="details">
            <div className="sect-head"><h2 id="details">Details</h2></div>
            <dl className="props">
              <div className="prop"><dt>Problem</dt><dd><Inline kind="textarea" value={item.problem} placeholder="Describe the problem" ariaLabel="problem" onSave={save("problem")} /></dd></div>
              <div className="prop"><dt>Team</dt><dd><Inline kind="select" options={TEAMS} value={item.team} display={<Team name={item.team} />} placeholder="Choose a team" ariaLabel="team" onSave={save("team")} /></dd></div>
              <div className="prop"><dt>Requested by</dt><dd><Inline value={item.requester} display={<><Avatar name={item.requester} size="sm" />&nbsp; {item.requester}</>} placeholder="Who asked" ariaLabel="requester" onSave={save("requester")} /></dd></div>
              <div className="prop"><dt>Owner</dt><dd><Inline value={item.owner} display={item.owner ? <><Avatar name={item.owner} size="sm" />&nbsp; {item.owner}</> : undefined} placeholder="Unassigned" ariaLabel="owner" onSave={save("owner")} /></dd></div>
              <div className="prop"><dt>Target</dt><dd><Inline kind="date" value={item.target_date} display={item.target_date ? fmtDay(item.target_date, now) : undefined} placeholder="No date" ariaLabel="target date" onSave={save("target_date")} /></dd></div>
              <div className="prop"><dt>Touches</dt><dd>{item.touches.length ? item.touches.join(", ") : <span className="nil">Not set</span>}</dd></div>
              <div className="prop"><dt>Source</dt><dd><Inline kind="url" value={item.link} display={item.link ? host(item.link) : undefined} placeholder="Add the thread or doc" ariaLabel="source link" onSave={save("link")} /></dd></div>
              <div className="prop"><dt>System</dt><dd><Inline kind="url" value={item.system_url} display={item.system_url ? host(item.system_url) : undefined} placeholder="Link it when it ships" ariaLabel="system link" onSave={save("system_url")} /></dd></div>
            </dl>
            {item.system_url && <a className="hint link" href={item.system_url} target="_blank" rel="noreferrer" style={{ justifySelf: "start" }}>Open the running system</a>}
          </section>
        </div>

        <div style={{ display: "grid", gap: 28, minWidth: 0 }}>
          <ResultsSection item={item} log={log} silent={silent} now={now} />
          <section className="sect" aria-labelledby="activity">
            <div className="sect-head"><h2 id="activity">Activity</h2></div>
            <div className="feed">
              {events.map((e) => (
                <div className="feed-row" key={e.id}>
                  <Avatar name={e.actor} size="sm" />
                  <span><b>{e.actor}</b> {describe(e.kind, e.detail)}</span>
                  <span className="t" title={new Date(e.at).toUTCString()}>{fmtDay(e.at, now)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

const host = (u: string) => { try { const x = new URL(u); return x.host + (x.pathname.length > 1 ? x.pathname : ""); } catch { return u; } };
/* Activity reads as a sentence after the person's name. */
function describe(kind: string, detail: string) {
  const m = detail.match(/^(\w+) → (\w+)$/);
  if (kind === "moved" && m) return `moved it to ${m[2].toLowerCase()}`;
  if (detail === "Accepted into Idea") return "accepted it into the queue";
  return detail[0].toLowerCase() + detail.slice(1);
}

function ScoreSection({ item, now }: { item: Item; now: Date }) {
  const [editing, setEditing] = useState(false);
  const init = () => ({ impact: item.impact ?? 3, reach: item.reach ?? 25, confidence: item.confidence ?? 80, effort_days: item.effort_days ?? 3 });
  const [d, setD] = useState(init);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setD(init()); }, [item, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = score(item);
  const stale = isScoreStale(item, now);
  const save = async () => { setBusy(true); const ok = await patchItem(item.id, d); setBusy(false); if (ok) setEditing(false); };
  const fig = (v: number | null, unit = "") => (v == null ? <span className="nil">–</span> : <>{fmtNum(v)}{unit}</>);

  return (
    <section className="sect" aria-labelledby="score">
      <div className="sect-head">
        <h2 id="score">Score</h2>
        {!editing && <button className="btn text compact" type="button" onClick={() => setEditing(true)}>{s == null ? "Add score" : stale ? "Rescore" : "Edit"}</button>}
      </div>
      <div className="score-card">
        {editing ? (
          <div className="score-edit">
            <Steps label="Impact" n={5} value={d.impact} onChange={(v) => setD({ ...d, impact: v })} show={`${d.impact} of 5`} titleFor={(n) => IMPACT_RUBRIC[n]} />
            <Slider label="Reach" min={0} max={500} step={5} value={d.reach} onChange={(v) => setD({ ...d, reach: v })} show={`${d.reach}/wk`} />
            <Steps label="Confidence" n={3} value={CONFIDENCE.indexOf(d.confidence as 50 | 80 | 100) + 1} onChange={(v) => setD({ ...d, confidence: CONFIDENCE[v - 1] })} show={`${d.confidence}%`} titleFor={(n) => `${CONFIDENCE[n - 1]}%`} />
            <Slider label="Effort" min={0.5} max={30} step={0.5} value={d.effort_days} onChange={(v) => setD({ ...d, effort_days: v })} show={`${d.effort_days} ${d.effort_days === 1 ? "day" : "days"}`} />
            <div className="panel-actions">
              <span className="hint">New score {fmtScore(score(d)!)} · {IMPACT_RUBRIC[d.impact]}</span>
              <button className="btn quiet compact" type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn primary compact" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save score"}</button>
            </div>
          </div>
        ) : (<>
          <div className="score-row">
            <div className="meter"><span className="label">Score</span><span className="fig" style={stale ? { color: "var(--ink-4)" } : undefined}>{s == null ? <span className="nil">–</span> : fmtScore(s)}</span></div>
            <div className="meter"><span className="label">Impact</span><span className="fig">{fig(item.impact)}</span></div>
            <div className="meter"><span className="label">Reach</span><span className="fig">{fig(item.reach)}</span></div>
            <div className="meter"><span className="label">Confidence</span><span className="fig">{fig(item.confidence, "%")}</span></div>
            <div className="meter"><span className="label">Effort</span><span className="fig">{fig(item.effort_days, "d")}</span></div>
          </div>
          <div className={`foot${stale ? " warn" : ""}`}>
            {s == null ? "Add all four inputs to rank it in the queue."
              : stale ? `Nobody has checked these inputs in ${daysSince(item.scored_at!, now)} days. It still ranks; rescore before trusting it.`
              : item.scored_at ? `Scored ${ago(item.scored_at, now)}${item.scored_by ? ` by ${item.scored_by}` : ""}. Impact × reach (accounts a week) × confidence ÷ effort (days).` : null}
          </div>
        </>)}
      </div>
    </section>
  );
}

function ResultsSection({ item, log, silent, now }: { item: Item; log: ShipLogEntry[]; silent: boolean; now: Date }) {
  const today = now.toISOString().slice(0, 10);
  const blank = { metric: "", value: "", unit: "", date: today, note: "" };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canLog = item.stage === "live";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const ok = await logResult(item.id, { ...f, value: f.value === "" ? null : Number(f.value) });
    setBusy(false);
    if (ok) { setF(blank); setOpen(false); }
  };
  return (
    <section className="sect" aria-labelledby="results">
      <div className="sect-head">
        <h2 id="results">Results</h2>
        {canLog && !open && <button className="btn text compact" type="button" onClick={() => setOpen(true)}>Log result</button>}
      </div>
      {silent && <p className="hint" style={{ color: "var(--warn)" }}>Live with no result in 30 days. Log what it did, or retire it.</p>}
      {open && (
        <form className="log-form" onSubmit={submit}>
          <div className="row4">
            <div className="field"><label htmlFor="lg-date">Measured</label><input id="lg-date" className="input" type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="lg-metric">What</label><input id="lg-metric" className="input" autoComplete="off" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} placeholder="booked from demo requests…" /></div>
            <div className="field"><label htmlFor="lg-value">Value</label><input id="lg-value" className="input mono" type="number" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="0" /></div>
            <div className="field"><label htmlFor="lg-unit">Unit</label><input id="lg-unit" className="input" autoComplete="off" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="meetings…" /></div>
          </div>
          <div className="field"><label htmlFor="lg-note">Note (optional)</label><input id="lg-note" className="input" autoComplete="off" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="How it was measured…" /></div>
          <div className="panel-actions">
            <button className="btn quiet compact" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary compact" type="submit" disabled={busy}>{busy ? "Saving…" : "Log result"}</button>
          </div>
        </form>
      )}
      {log.length === 0 ? (
        !open && <Empty>{canLog ? "No results yet. Log what this system did once it has run long enough to measure." : item.live_at ? "No results were logged while it was live." : "Results are logged once it is live."}</Empty>
      ) : (
        <div className="log">
          {log.map((l) => (
            <div className="log-row" key={l.id}>
              <span className="d">{fmtDay(l.date, now)}</span>
              <span className="m"><span>{l.metric}</span>{l.note && <span className="note">{l.note}</span>}</span>
              <span className="v">{fmtNum(l.value)}<span className="u">{l.unit === "%" ? "%" : ` ${l.unit}`}</span></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { CONFIDENCE, FLOW, IMPACT_RUBRIC, TEAMS, TOUCHES, canMove, isScoreStale, isSilent, score, type Item, type ShipLogEntry, type Stage } from "../../shared/domain";
import type { Shared } from "../App";
import { planMove } from "../forms";
import { ago, fmtDay, fmtNum, fmtScore, isTyping, linkClick, navigate } from "../lib";
import { logResult, moveItem, patchItem, useStore } from "../store";
import { Avatar, Empty, Icon, Inline, StageSelect, Team } from "../ui";
import { Slider, Steps, impactShow } from "./Triage";

/* The one forward move of each stage is the page's primary action. Everything else is reached from the stage word. */
const PRIMARY: Partial<Record<Stage, { to: Stage; text: string }>> = {
  triage: { to: "idea", text: "Accept" }, idea: { to: "building", text: "Start building" },
  building: { to: "live", text: "Mark live" }, declined: { to: "triage", text: "Reopen request" },
};

export function ItemPage({ id, shared }: { id: string; shared: Shared }) {
  const data = useStore((s) => s.data)!;
  const flash = useStore((s) => s.flash);
  const [logOpen, setLogOpen] = useState(false);
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
  const primary = PRIMARY[item.stage];
  const hasScore = score(item) != null;
  const showSystem = ["building", "live", "retired"].includes(item.stage) || !!item.system_url;
  const save = (field: string) => (v: string) => patchItem(item.id, { [field]: v === "" ? null : v });
  const back = item.stage === "triage" || item.stage === "declined" ? "/triage" : item.live_at ? "/shipped" : "/";
  const backName = back === "/triage" ? "Triage" : back === "/shipped" ? "Shipped" : "Queue";

  return (
    <>
      <nav className="crumbs" aria-label="Back">
        <a className="btn quiet compact" href={back} onClick={linkClick(back)}><Icon.back />{backName}</a>
      </nav>

      <header className="item-head">
        <h1><Inline value={item.title} placeholder="Untitled" ariaLabel="title" onSave={save("title")} flash={flash === item.id} /></h1>
        <div className="move-bar">
          <StageSelect stage={item.stage} silent={silent} moves={moves} onMove={go} />
          <span className="since">since {fmtDay(item.stage_changed_at, now)}</span>
          {primary && <button type="button" className="btn primary compact" onClick={() => go(primary.to)}>{primary.text}</button>}
          {item.stage === "live" && !logOpen && <button type="button" className="btn primary compact" onClick={() => setLogOpen(true)}>Log result</button>}
        </div>
        {item.decision_note && (item.stage === "declined" || item.stage === "retired") && (
          <div className="decision-note">
            <b>{item.stage === "declined" ? (merged ? "Merged" : "Declined") : "Retired"}.</b> {item.decision_note}
            {merged && <> <a className="btn quiet compact" href={`/item/${merged.id}`} onClick={linkClick(`/item/${merged.id}`)}>Open item</a></>}
          </div>
        )}
      </header>

      <div className="item-cols">
        <div style={{ display: "grid", gap: 28, minWidth: 0 }}>
          {!(item.stage === "declined" && !hasScore) && <ScoreSection item={item} now={now} />}
          <section className="sect" aria-labelledby="details">
            <div className="sect-head"><h2 id="details">Details</h2></div>
            <dl className="props">
              <div className="prop"><dt>Problem</dt><dd><Inline kind="textarea" value={item.problem} placeholder="Describe the problem" ariaLabel="problem" onSave={save("problem")} /></dd></div>
              <div className="prop"><dt>Team</dt><dd><Inline kind="select" options={TEAMS} value={item.team} display={<Team name={item.team} />} placeholder="Choose a team" ariaLabel="team" onSave={save("team")} /></dd></div>
              <div className="prop"><dt>Requested by</dt><dd><Inline value={item.requester} display={<><Avatar name={item.requester} size="sm" />&nbsp; {item.requester}</>} placeholder="Who asked" ariaLabel="requester" onSave={save("requester")} /></dd></div>
              <div className="prop"><dt>Owner</dt><dd><Inline value={item.owner} display={item.owner ? <><Avatar name={item.owner} size="sm" />&nbsp; {item.owner}</> : undefined} placeholder="Unassigned" ariaLabel="owner" onSave={save("owner")} /></dd></div>
              <div className="prop"><dt>Target</dt><dd><Inline kind="date" value={item.target_date} display={item.target_date ? fmtDay(item.target_date, now) : undefined} placeholder="No date" ariaLabel="target date" onSave={save("target_date")} /></dd></div>
              <div className="prop"><dt>Touches</dt><dd><TouchesField item={item} /></dd></div>
              <div className="prop"><dt>Source</dt><dd className="with-open"><div><Inline kind="url" value={item.link} display={item.link ? host(item.link) : undefined} placeholder="Add the thread or doc" ariaLabel="source link" onSave={save("link")} /></div>{item.link && <OpenLink href={item.link} what="the source" />}</dd></div>
              {showSystem && <div className="prop"><dt>System</dt><dd className="with-open"><div><Inline kind="url" value={item.system_url} display={item.system_url ? host(item.system_url) : undefined} placeholder="Link it when it ships" ariaLabel="system link" onSave={save("system_url")} /></div>{item.system_url && <OpenLink href={item.system_url} what="the system" />}</dd></div>}
            </dl>
          </section>
        </div>

        <div style={{ display: "grid", gap: 28, minWidth: 0 }}>
          {item.live_at && <ResultsSection item={item} log={log} now={now} open={logOpen} setOpen={setLogOpen} />}
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

/** The icon at the end of a row that opens what the row points to. */
function OpenLink({ href, what }: { href: string; what: string }) {
  return <a className="btn icon" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${what}`} title={`Open ${what}`}><Icon.external /></a>;
}

/** Touches are toggles, like on the New request sheet: click the value, pick, Save. */
function TouchesField({ item }: { item: Item }) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<string[]>(item.touches);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); const ok = await patchItem(item.id, { touches: d }); setBusy(false); if (ok) setEditing(false); };
  if (!editing) {
    return (
      <button type="button" className="editable" onClick={() => { setD(item.touches); setEditing(true); }} aria-label="Edit touches">
        {item.touches.length ? item.touches.join(", ") : <span className="placeholder">Not set</span>}
      </button>
    );
  }
  return (
    <div className="edit-stack" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }}>
      <div className="checks" role="group" aria-label="Touches">
        {TOUCHES.map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={d.includes(t)} onChange={(e) => setD(e.target.checked ? [...d, t] : d.filter((x) => x !== t))} />
            {t[0].toUpperCase() + t.slice(1)}
          </label>
        ))}
      </div>
      <div className="edit-row">
        <button className="btn primary compact" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn quiet compact" type="button" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
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
  const save = async () => { setBusy(true); const ok = await patchItem(item.id, { ...d, confirm_score: true }); setBusy(false); if (ok) setEditing(false); };
  const fig = (v: number | null, unit = "") => (v == null ? <span className="nil">–</span> : <>{fmtNum(v)}{unit}</>);

  return (
    <section className="sect" aria-labelledby="score">
      <div className="sect-head">
        <h2 id="score">Score</h2>
        {!editing && <button className="btn quiet compact" type="button" onClick={() => setEditing(true)}>{s == null ? "Add score" : stale ? "Rescore" : "Edit"}</button>}
      </div>
      <div className="score-card">
        {editing ? (
          <div className="score-edit">
            <Steps label="Impact" n={5} value={d.impact} onChange={(v) => setD({ ...d, impact: v })} show={impactShow(d.impact)} titleFor={(n) => IMPACT_RUBRIC[n]} />
            <Slider label="Reach" hint="Accounts per week" min={0} max={500} step={5} value={d.reach} onChange={(v) => setD({ ...d, reach: v })} show={`${d.reach}/wk`} />
            <Steps label="Confidence" n={3} value={CONFIDENCE.indexOf(d.confidence as 50 | 80 | 100) + 1} onChange={(v) => setD({ ...d, confidence: CONFIDENCE[v - 1] })} show={`${d.confidence}%`} titleFor={(n) => `${CONFIDENCE[n - 1]}%`} />
            <Slider label="Effort" hint="Engineering days" min={0.5} max={30} step={0.5} value={d.effort_days} onChange={(v) => setD({ ...d, effort_days: v })} show={`${d.effort_days} ${d.effort_days === 1 ? "day" : "days"}`} />
            <div className="panel-actions">
              <span className="hint">New score {fmtScore(score(d)!)}</span>
              <button className="btn quiet compact" type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn primary compact" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save score"}</button>
            </div>
          </div>
        ) : (<>
          <div className="score-row">
            <div className="meter"><span className="label" title="Impact × reach (accounts a week) × confidence ÷ effort (days)">Score</span><span className="fig" style={stale ? { color: "var(--ink-4)" } : undefined}>{s == null ? <span className="nil">–</span> : fmtScore(s)}</span></div>
            <div className="meter"><span className="label">Impact</span><span className="fig">{fig(item.impact)}</span></div>
            <div className="meter"><span className="label">Reach</span><span className="fig">{fig(item.reach)}</span></div>
            <div className="meter"><span className="label">Confidence</span><span className="fig">{fig(item.confidence, "%")}</span></div>
            <div className="meter"><span className="label">Effort</span><span className="fig">{fig(item.effort_days, "d")}</span></div>
          </div>
          {s != null && item.scored_at && (
            <div className="foot">
              Scored {stale ? <b>{ago(item.scored_at, now)}</b> : ago(item.scored_at, now)}{item.scored_by ? ` · ${item.scored_by}` : ""}
            </div>
          )}
        </>)}
      </div>
    </section>
  );
}

function ResultsSection({ item, log, now, open, setOpen }: { item: Item; log: ShipLogEntry[]; now: Date; open: boolean; setOpen: (v: boolean) => void }) {
  const today = now.toISOString().slice(0, 10);
  const blank = { metric: "", value: "", unit: "", date: today, note: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const ok = await logResult(item.id, { ...f, value: f.value === "" ? null : Number(f.value) });
    setBusy(false);
    if (ok) { setF(blank); setOpen(false); }
  };
  return (
    <section className="sect" aria-labelledby="results">
      <div className="sect-head"><h2 id="results">Results</h2></div>
      {open && (
        <form className="log-form" onSubmit={submit}>
          <div className="row4">
            <div className="field"><label htmlFor="lg-date">Measured</label><input id="lg-date" className="input" type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="lg-metric">What</label><input id="lg-metric" className="input" autoComplete="off" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} placeholder="Meetings booked from demo requests" /></div>
            <div className="field"><label htmlFor="lg-value">Value</label><input id="lg-value" className="input mono" type="number" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="0" /></div>
            <div className="field"><label htmlFor="lg-unit">Unit</label><input id="lg-unit" className="input" autoComplete="off" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="meetings" /></div>
          </div>
          <div className="field"><label htmlFor="lg-note">Note (optional)</label><input id="lg-note" className="input" autoComplete="off" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="How it was measured" /></div>
          <div className="panel-actions">
            <button className="btn quiet compact" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary compact" type="submit" disabled={busy}>{busy ? "Saving…" : "Log result"}</button>
          </div>
        </form>
      )}
      {log.length === 0 ? (
        !open && <Empty>No results logged.</Empty>
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

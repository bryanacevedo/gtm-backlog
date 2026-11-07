import { useCallback, useMemo, useState } from "react";
import { FLOW, TEAMS, isSilent, label, rank, score, type Item, type Stage } from "../../shared/domain";
import type { Shared } from "../App";
import { planMove } from "../forms";
import { ago, fmtNum, fmtScore, linkClick, navigate, plural, useQueryParam } from "../lib";
import { useRowFocus } from "../rows";
import { moveItem, toast, useStore } from "../store";
import { Avatar, Empty, Mark, StageLabel, Team } from "../ui";

const NOTE: Record<string, string> = { idea: "named, not started", building: "in flight now", live: "shipped and running" };
const EMPTY: Record<string, string> = {
  idea: "Nothing waiting. Accepted requests land here.",
  building: "Nothing under construction. Move an idea here when work starts.",
  live: "Nothing shipped yet. Items go live with a link to the running system.",
};

export function Board({ shared }: { shared: Shared }) {
  const data = useStore((s) => s.data)!;
  const flash = useStore((s) => s.flash);
  const [team, setTeam] = useQueryParam("team");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const now = new Date();

  const cols = useMemo(() => {
    const items = data.items.filter((i) => FLOW.includes(i.stage) && (!team || i.team === team));
    return Object.fromEntries(FLOW.map((s) => [s, s === "live"
      ? items.filter((i) => i.stage === s).sort((a, b) => (b.live_at ?? "").localeCompare(a.live_at ?? ""))
      : rank(items.filter((i) => i.stage === s))])) as Record<Stage, Item[]>;
  }, [data.items, team]);
  const order = FLOW.flatMap((s) => cols[s].map((i) => i.id));
  const byId = (id: string) => data.items.find((i) => i.id === id)!;

  const tryMove = useCallback((item: Item, to: Stage) => {
    if (item.stage === to) return;
    const p = planMove(item, to);
    if (p) shared.requestMove(p); else moveItem(item.id, to);
  }, [shared]);

  const step = useCallback((e: KeyboardEvent, id: string) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    const item = byId(id);
    const i = FLOW.indexOf(item.stage);
    const to = FLOW[i + (e.key === "ArrowRight" ? 1 : -1)];
    if (!to) { toast(e.key === "ArrowRight" ? "Live is the last stage on the board. Retire it from the item page." : "Idea is the first stage on the board."); return true; }
    tryMove(item, to);
    return true;
  }, [data.items, tryMove]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focus, setFocus] = useRowFocus(order, step);

  const teamsHere = TEAMS.filter((t) => data.items.some((i) => FLOW.includes(i.stage) && i.team === t));

  return (
    <>
      <header className="page-head">
        <h1>Board</h1>
        <span className="count">{FLOW.reduce((n, s) => n + cols[s].length, 0)}</span>
        <span className="spacer" />
        <div className="actions">
          <label className="sr-only" htmlFor="board-team">Team</label>
          <select id="board-team" className="select" style={{ width: "auto", minWidth: 150, minHeight: 30 }} value={team ?? ""} onChange={(e) => setTeam(e.target.value || null)}>
            <option value="">All teams</option>
            {teamsHere.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </header>

      <div className="board">
        {FLOW.map((stage) => (
          <section key={stage} className="col" aria-labelledby={`col-${stage}`}>
            <div className="col-head">
              <StageLabel stage={stage} />
              <h2 id={`col-${stage}`} className="sr-only">{label(stage)}</h2>
              <span className="n">{cols[stage].length}</span>
              <span className="note">{NOTE[stage]}</span>
            </div>
            <div className="col-body" data-drop={over === stage || undefined}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) tryMove(byId(dragging), stage); setDragging(null); }}>
              {cols[stage].length === 0
                ? <Empty>{team ? `No ${team} items in ${label(stage)}.` : EMPTY[stage]}</Empty>
                : cols[stage].map((item) => (
                  <Card key={item.id} item={item} focused={focus === item.id} flashed={flash === item.id} dragging={dragging === item.id} now={now}
                    silent={isSilent(item, data.shipLog.filter((l) => l.item_id === item.id), now)}
                    latest={data.shipLog.find((l) => l.item_id === item.id)}
                    onFocus={() => setFocus(item.id)}
                    onDragStart={() => setDragging(item.id)} onDragEnd={() => { setDragging(null); setOver(null); }} />
                ))}
            </div>
          </section>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>{plural(data.items.filter((i) => i.stage === "triage").length, "request")} waiting in <a href="/triage" onClick={linkClick("/triage")}>Triage</a> do not appear here until accepted.</p>
    </>
  );
}

function Card({ item, focused, flashed, dragging, silent, latest, now, onFocus, onDragStart, onDragEnd }: {
  item: Item; focused: boolean; flashed: boolean; dragging: boolean; silent: boolean; now: Date;
  latest?: { metric: string; value: number; unit: string; date: string };
  onFocus: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const s = score(item);
  const href = `/item/${item.id}`;
  return (
    <article className="card" data-row={item.id} draggable tabIndex={0} aria-label={`${item.title}, ${label(item.stage)}`}
      data-dragging={dragging || undefined} data-flash={flashed || undefined} data-focus={focused || undefined}
      onFocus={onFocus} onMouseEnter={onFocus}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) navigate(href); }}
      onKeyDown={(e) => { if (e.key === "Enter") navigate(href); }}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.id); onDragStart(); }}
      onDragEnd={onDragEnd}>
      <div className="eyebrow"><span><Team name={item.team} /></span>{silent && <span style={{ color: "var(--warn)" }}><Mark kind="silent" /> Silent</span>}</div>
      <a className="title" href={href} onClick={linkClick(href)} tabIndex={-1} style={{ color: "inherit" }}>{item.title}</a>
      {item.stage === "live" && latest
        ? <div className="result"><b>{fmtNum(latest.value)}{latest.unit === "%" ? "%" : ` ${latest.unit}`}</b> {latest.metric}</div>
        : null}
      <div className="meta">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>{item.owner && <Avatar name={item.owner} size="sm" />}{item.stage === "live" ? `Live ${ago(item.live_at ?? item.stage_changed_at, now)}` : item.owner ?? ""}</span>
        {item.stage !== "live" && (s == null ? <span className="score-none">Unscored</span> : <span className="score">{fmtScore(s)}</span>)}
      </div>
    </article>
  );
}

import { useMemo } from "react";
import { OPEN, SCORE_HELP, isScoreStale, rank, score, teamsOf, type Item } from "../../shared/domain";
import type { Shared } from "../App";
import { agoShort, daysSince, fmtNum, fmtScore, linkClick, navigate, useQueryParam } from "../lib";
import { useRowFocus } from "../rows";
import { useStore } from "../store";
import { Avatar, Empty, StageLabel, Team, Tip } from "../ui";

export function Queue({ shared }: { shared: Shared }) {
  const data = useStore((s) => s.data)!;
  const flash = useStore((s) => s.flash);
  const [team, setTeam] = useQueryParam("team");
  const now = new Date();

  const open = useMemo(() => rank(data.items.filter((i) => OPEN.includes(i.stage))), [data.items]);
  const shown = team ? open.filter((i) => i.team === team) : open;
  const building = shown.filter((i) => i.stage === "building").length;
  const unscored = shown.filter((i) => score(i) == null).length;
  const teams = useMemo(() => teamsOf(open).filter((t) => open.some((i) => i.team === t)), [open]);
  const [focus, setFocus] = useRowFocus(shown.map((i) => i.id));

  return (
    <>
      <header className="page-head">
        <h1>Queue</h1>
        <span className="count">{shown.length}</span>
        <span className="spacer" />
        <span className="sub">{building} building{unscored ? ` · ${unscored} unscored` : ""}</span>
        {teams.length > 0 && (
          <div className="actions team-filter">
            <label className="sr-only" htmlFor="queue-team">Team</label>
            <select id="queue-team" className="select" value={team ?? ""} onChange={(e) => setTeam(e.target.value || null)}>
              <option value="">All teams</option>
              {teams.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        )}
      </header>

      {shown.length === 0 ? (
        <Empty>{team ? `No open requests from ${team}.` : "No open requests."}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col" className="pin pin-1">#</th>
                <th scope="col" className="pin pin-2 title">Request</th>
                <th scope="col">Team</th>
                <th scope="col" className="stage-col">Stage</th>
                <th scope="col" className="num col-inputs"><Tip lines={SCORE_HELP.impact}>Impact</Tip></th>
                <th scope="col" className="num col-inputs"><Tip lines={SCORE_HELP.reach}>Reach</Tip></th>
                <th scope="col" className="num col-inputs"><Tip lines={SCORE_HELP.confidence}>Confidence</Tip></th>
                <th scope="col" className="num col-inputs"><Tip lines={SCORE_HELP.effort}>Effort</Tip></th>
                <th scope="col" className="num"><Tip lines={SCORE_HELP.score}>Score</Tip></th>
                <th scope="col" className="who">Owner</th>
                <th scope="col" className="num" title="Days in the current stage">Age</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item, i) => <Row key={item.id} item={item} n={i + 1} focused={focus === item.id} flashed={flash === item.id} now={now} onFocus={() => setFocus(item.id)} />)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Row({ item, n, focused, flashed, now, onFocus }: { item: Item; n: number; focused: boolean; flashed: boolean; now: Date; onFocus: () => void }) {
  const s = score(item);
  const stale = isScoreStale(item, now);
  const href = `/item/${item.id}`;
  const cell = (v: number | null, unit = "") => <td className="num col-inputs in">{v == null ? <span className="nil">–</span> : <>{fmtNum(v)}{unit && <span className="unit">{unit}</span>}</>}</td>;
  return (
    <tr data-row={item.id} data-focus={focused || flashed || undefined}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) navigate(href); }} onMouseEnter={onFocus}>
      <td className="rank pin pin-1">{s == null ? "–" : n}</td>
      <td className="title pin pin-2"><a href={href} onClick={linkClick(href)} title={item.title}>{item.title}</a></td>
      <td className="team"><Team name={item.team} /></td>
      <td className="stage-col"><StageLabel stage={item.stage} /></td>
      {cell(item.impact)}{cell(item.reach, "/wk")}{cell(item.confidence, "%")}{cell(item.effort_days, item.effort_days === 1 ? " day" : " days")}
      <td className="num score-col" title={stale ? `Scored ${daysSince(item.scored_at!, now)} days ago. Rescore on the item page.` : undefined}>
        {s == null ? <span className="score-none">Unscored</span> : <span className={`score${stale ? " stale" : ""}`}>{fmtScore(s)}</span>}
      </td>
      <td className="who">{item.owner && <><Avatar name={item.owner} size="sm" /> {item.owner.split(/\s+/)[0]}</>}</td>
      <td className="num age">{agoShort(item.stage_changed_at, now)}</td>
    </tr>
  );
}

import { useMemo } from "react";
import { OPEN, isScoreStale, rank, score, type Item } from "../../shared/domain";
import type { Shared } from "../App";
import { agoShort, daysSince, fmtNum, fmtScore, linkClick, navigate, plural, useQueryParam } from "../lib";
import { useRowFocus } from "../rows";
import { useStore } from "../store";
import { Avatar, Empty, Icon, StageLabel, Team } from "../ui";

export function Queue({ shared }: { shared: Shared }) {
  const data = useStore((s) => s.data)!;
  const flash = useStore((s) => s.flash);
  const [team, setTeam] = useQueryParam("team");
  const now = new Date();

  const open = useMemo(() => rank(data.items.filter((i) => OPEN.includes(i.stage))), [data.items]);
  const shown = team ? open.filter((i) => i.team === team) : open;
  const building = shown.filter((i) => i.stage === "building").length;
  const unscored = shown.filter((i) => score(i) == null).length;
  const [focus, setFocus] = useRowFocus(shown.map((i) => i.id));

  return (
    <>
      <header className="page-head">
        <h1>Queue</h1>
        <span className="count">{shown.length}</span>
        {team && (
          <button className="btn quiet compact" type="button" onClick={() => setTeam(null)} aria-label={`Clear the ${team} filter`}>
            <span><Team name={team} /></span><Icon.close />
          </button>
        )}
        <span className="spacer" />
        <span className="sub">{building} in build{unscored ? ` · ${plural(unscored, "item")} unscored` : ""}</span>
      </header>

      {shown.length === 0 ? (
        <Empty action={<button className="btn quiet compact" type="button" onClick={shared.openNew}>New request</button>}>
          {team ? `Nothing from ${team} is waiting to be built.` : "Nothing is waiting to be built. Accepted requests land here, ranked by score."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col" className="pin pin-1">#</th>
                <th scope="col" className="pin pin-2 title">Request</th>
                <th scope="col">Team</th>
                <th scope="col">Stage</th>
                <th scope="col" className="num col-inputs" title="1 a convenience, 5 moves bookings this quarter">Impact</th>
                <th scope="col" className="num col-inputs" title="Accounts affected per week">Reach</th>
                <th scope="col" className="num col-inputs" title="How sure the impact is">Conf.</th>
                <th scope="col" className="num col-inputs" title="Engineering days">Effort</th>
                <th scope="col" className="num">Score</th>
                <th scope="col">Owner</th>
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
      <td><StageLabel stage={item.stage} /></td>
      {cell(item.impact)}{cell(item.reach, "/wk")}{cell(item.confidence, "%")}{cell(item.effort_days, "d")}
      <td className="num" title={stale ? `Scored ${daysSince(item.scored_at!, now)} days ago. Rescore on the item page.` : undefined}>
        {s == null ? <span className="score-none">Unscored</span> : <>{stale && <span className="stale-tag">stale</span>}<span className={`score${stale ? " stale" : ""}`}>{fmtScore(s)}</span></>}
      </td>
      <td className="who"><Avatar name={item.owner} size="sm" /></td>
      <td className="num age">{agoShort(item.stage_changed_at, now)}</td>
    </tr>
  );
}

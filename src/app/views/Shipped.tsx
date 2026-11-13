import { useMemo } from "react";
import { isSilent, type Item, type ShipLogEntry } from "../../shared/domain";
import { daysSince, fmtDay, fmtMonth, fmtNum, linkClick, plural } from "../lib";
import { useStore } from "../store";
import { Avatar, Empty, Icon, StageLabel, Team } from "../ui";

export function Shipped() {
  const data = useStore((s) => s.data)!;
  const now = new Date();

  const { months, meters } = useMemo(() => {
    const shipped = data.items.filter((i) => i.live_at).sort((a, b) => b.live_at!.localeCompare(a.live_at!));
    const logFor = (id: string) => data.shipLog.filter((l) => l.item_id === id);
    const groups = new Map<string, Item[]>();
    for (const i of shipped) {
      const k = i.live_at!.slice(0, 7);
      groups.set(k, [...(groups.get(k) ?? []), i]);
    }
    const live = shipped.filter((i) => i.stage === "live");
    return {
      months: [...groups.entries()],
      meters: {
        thisMonth: shipped.filter((i) => i.live_at!.slice(0, 7) === now.toISOString().slice(0, 7)).length,
        live: live.length,
        silent: live.filter((i) => isSilent(i, logFor(i.id), now)).length,
        results30: data.shipLog.filter((l) => daysSince(l.date, now) <= 30).length,
      },
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header className="page-head">
        <h1>Shipped</h1>
        <span className="count">{months.reduce((n, [, i]) => n + i.length, 0)}</span>
      </header>

      <div className="meters" role="group" aria-label="Summary">
        <Meter label={`Shipped in ${fmtMonth(now.toISOString()).split(" ")[0]}`} fig={meters.thisMonth} />
        <Meter label="Live" fig={meters.live} />
        <Meter label="Silent" fig={meters.silent} attn={meters.silent > 0} />
        <Meter label="Results, last 30 days" fig={meters.results30} />
      </div>

      {months.length === 0 ? (
        <Empty>Nothing shipped yet.</Empty>
      ) : months.map(([key, items]) => (
        <section className="month" key={key} aria-labelledby={`m-${key}`}>
          <div className="month-head"><h2 id={`m-${key}`}>{fmtMonth(key + "-01")}</h2><span className="n">{plural(items.length, "release")}</span></div>
          {items.map((item) => <ShipRow key={item.id} item={item} log={data.shipLog.filter((l) => l.item_id === item.id)} now={now} />)}
        </section>
      ))}
    </>
  );
}

function Meter({ label, fig, attn }: { label: string; fig: number; attn?: boolean }) {
  return (
    <div className="meter">
      <span className="label">{label}</span>
      <span className={`fig${attn ? " attn" : ""}`}>{fig}</span>
    </div>
  );
}

function ShipRow({ item, log, now }: { item: Item; log: ShipLogEntry[]; now: Date }) {
  const latest = log[0];
  const silent = isSilent(item, log, now);
  const href = `/item/${item.id}`;
  return (
    <div className="ship-row">
      <div className="what">
        <a className="t" href={href} onClick={linkClick(href)}>{item.title}</a>
        <span className="by"><Avatar name={item.owner} size="sm" /> {item.owner ?? "GTM team"} for <Team name={item.team} /></span>
      </div>
      <div className="res">
        {latest ? (<>
          <span className="m">{latest.metric}</span>
          <span className="v">{fmtNum(latest.value)}<span className="u">{latest.unit === "%" ? "%" : ` ${latest.unit}`}</span></span>
          <span className="d">Measured {fmtDay(latest.date, now)}{log.length > 1 ? ` · ${plural(log.length, "result")} logged` : ""}</span>
        </>) : <span className="d">{item.stage === "retired" ? "No results were logged." : "No result logged yet."}</span>}
        {(silent || item.stage === "retired") && <span className="st"><StageLabel stage={item.stage} silent={silent} /></span>}
      </div>
      <div className="when">
        <span>{fmtDay(item.live_at!, now)}</span>
        {item.system_url && <a className="btn icon" href={item.system_url} target="_blank" rel="noreferrer" aria-label={`Open the system for ${item.title}`} title="Open the system"><Icon.external /></a>}
      </div>
    </div>
  );
}

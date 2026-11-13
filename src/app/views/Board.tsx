import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { FLOW, isSilent, label, score, type Item, type ShipLogEntry, type Stage } from "../../shared/domain";
import type { Shared } from "../App";
import { columnsOf, columnSums, movedTo, nearestStage, pullRequests, slotIndex, stageStep } from "../board-logic";
import { planMove } from "../forms";
import { agoShort, fmtNum, fmtScore, isTyping, linkClick, navigate, useQueryParam } from "../lib";
import { useRowFocus } from "../rows";
import { getState, moveItem, useStore } from "../store";
import { Avatar, Keys, Team } from "../ui";

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const noDrag = () => matchMedia("(max-width: 760px)").matches || matchMedia("(pointer: coarse)").matches;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";

interface Drag { id: string; home: Stage; over: Stage; left: number; top: number; width: number; phase: "lift" | "drop" }

export function Board({ shared }: { shared: Shared }) {
  const data = useStore((s) => s.data)!;
  const flash = useStore((s) => s.flash);
  const [team, setTeam] = useQueryParam("team");
  const [view, setView] = useState<Stage>("building"); // the phone shows one stage at a time
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lifted, setLifted] = useState(false);
  const [keysHost, setKeysHost] = useState<HTMLElement | null>(null);
  const now = new Date(), nowIso = now.toISOString();
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLElement>(null);

  const cols = useMemo(() => columnsOf(data.items, team), [data.items, team]);
  const order = FLOW.flatMap((s) => cols[s].map((i) => i.id));
  const latest = useMemo(() => {
    const m = new Map<string, ShipLogEntry>();
    for (const l of data.shipLog) if (!m.has(l.item_id)) m.set(l.item_id, l); // the log arrives newest first
    return m;
  }, [data.shipLog]);
  const logsOf = useCallback((id: string) => data.shipLog.filter((l) => l.item_id === id), [data.shipLog]);

  /* A card in the hand, or waiting under the link dialog, is shown as a slot in the column it is headed for, at the place its rank gives it. */
  const parked = shared.pending && FLOW.includes(shared.pending.to) && shared.pending.item.stage !== shared.pending.to ? shared.pending : null;
  const moving = drag?.id ?? parked?.item.id ?? null;
  const target = drag ? drag.over : parked ? parked.to : null;
  const shown = useMemo(() => {
    type Entry = { item: Item; slot?: boolean };
    const out = {} as Record<Stage, Entry[]>;
    const mover = moving ? data.items.find((i) => i.id === moving) : undefined;
    for (const s of FLOW) {
      const list: Entry[] = cols[s].filter((i) => i.id !== moving).map((item) => ({ item }));
      if (mover && target === s) {
        const at = slotIndex(s, cols[s], mover, nowIso);
        list.splice(at, 0, { item: s === mover.stage ? mover : movedTo(mover, s, nowIso), slot: true });
      }
      out[s] = list;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, moving, target, data.items]);

  /* ----------------------------------------------------------- moving a card */

  const lastMove = useRef<{ id: string; stage: Stage; at: number } | null>(null);
  const keepFocus = useRef<string | null>(null);
  const tryMove = useCallback((id: string, to: Stage, how: "drop" | "keys" | "phone") => {
    const item = getState().data?.items.find((i) => i.id === id);
    if (!item || item.stage === to) return;
    const from = item.stage;
    const p = planMove(item, to);
    if (p) { shared.requestMove(p); return; }
    if (how === "keys") keepFocus.current = id;
    void moveItem(id, to, { undoKey: "Z" }).then((ok) => { if (ok) lastMove.current = { id, stage: from, at: Date.now() }; });
  }, [shared]);

  const step = useCallback((e: KeyboardEvent, id: string) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    const item = data.items.find((i) => i.id === id);
    const to = item && stageStep(item.stage, e.key === "ArrowRight" ? 1 : -1);
    if (to) tryMove(id, to, "keys");
    return true;
  }, [data.items, tryMove]);
  const [focus, setFocus] = useRowFocus(order, step);

  useEffect(() => { // Z puts the last move back, for as long as the toast offers it
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "z" && e.key !== "Z") || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector(".scrim")) return;
      const u = lastMove.current;
      if (!u || Date.now() - u.at > 8000) return;
      e.preventDefault(); lastMove.current = null;
      keepFocus.current = u.id;
      void moveItem(u.id, u.stage, { silent: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { setKeysHost(document.getElementById("stage-keys")); }, []);

  /* ------------------------------------------------------------------ drag */

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onUpRef = useRef<() => void>(() => {});
  const onCancelRef = useRef<() => void>(() => {});
  const onEscRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const moveWrap = useCallback((e: PointerEvent) => onMoveRef.current(e), []);
  const upWrap = useCallback(() => onUpRef.current(), []);
  const cancelWrap = useCallback(() => onCancelRef.current(), []);
  const escWrap = useCallback((e: KeyboardEvent) => onEscRef.current(e), []);
  const sess = useRef<{ id: string; home: Stage; over: Stage; x: number; y: number; px: number; py: number; el: HTMLElement; started: boolean; raf: number; left: number; top: number } | null>(null);
  const suppressClick = useRef(false);

  const centres = () => [...boardRef.current!.querySelectorAll<HTMLElement>(".col")].map((c) => { const r = c.getBoundingClientRect(); return { stage: c.dataset.stage as Stage, centre: r.left + r.width / 2 }; });

  const finish = useCallback((cancel: boolean) => {
    const s = sess.current; if (!s) return;
    sess.current = null;
    window.removeEventListener("pointermove", moveWrap); window.removeEventListener("pointerup", upWrap); window.removeEventListener("pointercancel", cancelWrap);
    document.removeEventListener("keydown", escWrap, true);
    cancelAnimationFrame(s.raf);
    s.el.removeAttribute("data-press");
    if (!s.started) return;
    suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
    if (cancel && s.over !== s.home) flushSync(() => setDrag((d) => (d ? { ...d, over: s.home } : d)));
    const over = cancel ? s.home : s.over;
    const end = () => {
      delete document.body.dataset.dragging;
      setDrag(null); setLifted(false);
      if (over !== s.home) tryMove(s.id, over, "drop");
    };
    const slot = boardRef.current?.querySelector<HTMLElement>(".card.is-slot"), ghost = ghostRef.current;
    if (calm() || !slot || !ghost) { end(); return; }
    const r = slot.getBoundingClientRect();
    setDrag((d) => (d ? { ...d, phase: "drop" } : d));
    ghost.style.translate = `${r.left - s.left}px ${r.top - s.top}px`; // the card travels to the slot in 160ms
    setTimeout(end, 170);
  }, [tryMove, moveWrap, upWrap, cancelWrap, escWrap]);

  onMoveRef.current = (e) => {
    const s = sess.current; if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.started) {
      if (Math.hypot(dx, dy) < 4) return;
      s.started = true; s.el.removeAttribute("data-press");
      const r = s.el.getBoundingClientRect();
      s.left = r.left; s.top = r.top;
      document.body.dataset.dragging = "true";
      flushSync(() => setDrag({ id: s.id, home: s.home, over: s.home, left: r.left, top: r.top, width: r.width, phase: "lift" }));
      requestAnimationFrame(() => setLifted(true));
      const tick = () => { // near the top or bottom of a column, it scrolls
        const body = boardRef.current?.querySelector<HTMLElement>(`.col[data-stage="${s.over}"] .col-body`);
        if (body && sess.current === s) { const r2 = body.getBoundingClientRect(); if (s.py < r2.top + 36) body.scrollTop -= 8; else if (s.py > r2.bottom - 36) body.scrollTop += 8; s.raf = requestAnimationFrame(tick); }
      };
      s.raf = requestAnimationFrame(tick);
    }
    s.px = e.clientX; s.py = e.clientY;
    if (ghostRef.current) ghostRef.current.style.translate = `${dx}px ${dy}px`;
    const over = nearestStage(e.clientX, centres(), s.over);
    if (over !== s.over) { s.over = over; setDrag((d) => (d ? { ...d, over } : d)); }
  };
  onUpRef.current = () => finish(false);
  onCancelRef.current = () => finish(true);
  onEscRef.current = (e) => { if (e.key === "Escape" && sess.current?.started) { e.preventDefault(); e.stopPropagation(); finish(true); } };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, item: Item) => {
    if (e.button !== 0 || e.pointerType === "touch" || noDrag() || (e.target as HTMLElement).closest(".stage-ctl")) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.dataset.press = "true"; // acknowledged on pointer-down, before any drag is known
    el.focus({ preventScroll: true });
    sess.current = { id: item.id, home: item.stage, over: item.stage, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, el, started: false, raf: 0, left: 0, top: 0 };
    // The handlers are stable wrappers that call the newest closure, so the same function can be added and removed.
    window.addEventListener("pointermove", moveWrap); window.addEventListener("pointerup", upWrap); window.addEventListener("pointercancel", cancelWrap);
    document.addEventListener("keydown", escWrap, true);
  };
  useEffect(() => () => { delete document.body.dataset.dragging; }, []);

  /* --------------------------------------- siblings slide, a card crossing columns flies */

  const rects = useRef(new Map<string, DOMRect>());
  const stages = useRef(new Map<string, string>());
  const measure = () => {
    const m = new Map<string, DOMRect>(), st = new Map<string, string>();
    boardRef.current?.querySelectorAll<HTMLElement>(".card[data-row]").forEach((c) => { m.set(c.dataset.row!, c.getBoundingClientRect()); st.set(c.dataset.row!, c.closest<HTMLElement>(".col")!.dataset.stage!); });
    rects.current = m; stages.current = st;
  };
  useLayoutEffect(() => {
    const root = boardRef.current; if (!root) return;
    const before = rects.current, beforeStage = stages.current;
    if (keepFocus.current) {
      const c = root.querySelector<HTMLElement>(`.card[data-row="${keepFocus.current}"]`); keepFocus.current = null;
      c?.focus({ preventScroll: true }); c?.scrollIntoView({ block: "nearest" });
    }
    if (!calm() && before.size) {
      root.querySelectorAll<HTMLElement>(".card[data-row]").forEach((c) => {
        const id = c.dataset.row!, b = before.get(id); if (!b) return;
        const a = c.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
        if (!dx && !dy) return;
        const crossed = beforeStage.get(id) !== c.closest<HTMLElement>(".col")!.dataset.stage;
        if (crossed && !c.classList.contains("is-slot") && !sess.current && !noDrag()) { // a lifted copy, because a scrolling column clips its children
          const g = c.cloneNode(true) as HTMLElement; g.classList.add("ghost"); g.dataset.lift = "true"; g.removeAttribute("data-focus"); g.removeAttribute("data-row");
          Object.assign(g.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px" });
          document.body.append(g); c.style.opacity = "0"; // not visibility: a hidden element loses keyboard focus
          g.animate([{ translate: `${dx}px ${dy}px`, scale: 1.02 }, { translate: "0 0", scale: 1 }], { duration: 180, easing: EASE }).finished.then(() => { g.remove(); c.style.opacity = ""; }, () => { g.remove(); c.style.opacity = ""; });
        } else if (!crossed) c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 160, easing: EASE });
      });
    }
    root.querySelector(".card.is-slot")?.scrollIntoView({ block: "nearest" });
    measure();
  });
  useEffect(() => {
    const root = boardRef.current; if (!root) return;
    const onScroll = (e: Event) => { const col = (e.target as HTMLElement).closest?.(".col"); col?.toggleAttribute("data-scrolled", (e.target as HTMLElement).scrollTop > 0); measure(); };
    root.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    return () => { root.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", measure); };
  }, []);

  /* ------------------------------------------------------------------ view */

  const teamsHere = useMemo(() => [...new Set(data.items.filter((i) => FLOW.includes(i.stage)).map((i) => i.team))], [data.items]);
  const focusItem = focus ? data.items.find((i) => i.id === focus) : null;
  const dragItem = drag ? data.items.find((i) => i.id === drag.id) : null;
  const total = FLOW.reduce((n, s) => n + cols[s].length, 0);

  const cardProps = (item: Item) => ({
    item, now, latest: latest.get(item.id), silent: isSilent(item, logsOf(item.id), now), prs: pullRequests(data.workLinks, item.id),
    onStage: (to: Stage) => tryMove(item.id, to, "phone"),
  });

  return (
    <>
      <header className="page-head">
        <h1>Board</h1>
        <span className="count">{total}</span>
        <span className="spacer" />
        <div className="actions">
          <label className="sr-only" htmlFor="board-team">Team</label>
          <select id="board-team" className="select" style={{ width: "auto", minWidth: 150, minHeight: 30 }} value={team ?? ""} onChange={(e) => setTeam(e.target.value || null)}>
            <option value="">All teams</option>
            {teamsHere.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </header>

      <div className="tabs stage-tabs" role="tablist" aria-label="Stage">
        {FLOW.map((s) => <button key={s} className="tab" type="button" role="tab" aria-selected={view === s} onClick={() => setView(s)}>{label(s)}<span className="n">{cols[s].length}</span></button>)}
      </div>

      <div className="board" ref={boardRef} data-view={view}>
        {FLOW.map((stage) => {
          const sums = columnSums(stage, cols[stage], data.workLinks, data.shipLog, now);
          return (
            <section key={stage} className="col" data-stage={stage} data-empty={!shown[stage].length || undefined} aria-labelledby={`col-${stage}`}>
              <div className="col-head">
                <h2 id={`col-${stage}`}>{label(stage)}</h2>
                <span className="n">{cols[stage].length}</span>
                <span className="sums">
                  {sums.score != null && <span><b>{fmtScore(sums.score)}</b> score</span>}
                  {sums.unscored != null && <span><b>{sums.unscored}</b> unscored</span>}
                  {sums.openPrs != null && <span><b>{sums.openPrs}</b> open {sums.openPrs === 1 ? "PR" : "PRs"}</span>}
                  {sums.measured != null && <span><b>{sums.measured}</b> measured</span>}
                  {sums.silent != null && <span><b>{sums.silent}</b> silent</span>}
                </span>
              </div>
              <div className="col-body">
                {shown[stage].map(({ item, slot }) => (
                  <Card key={item.id} {...cardProps(item)} slot={slot} focused={focus === item.id} flashed={flash === item.id}
                    onFocus={() => { if (!sess.current) setFocus(item.id); }}
                    onPointerDown={(e) => onPointerDown(e, item)}
                    suppress={suppressClick} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {drag && dragItem && createPortal(
        <Card {...cardProps(dragItem)} ghost ref={ghostRef} lift={drag.phase === "drop" ? "drop" : lifted ? "true" : undefined}
          style={{ left: drag.left, top: drag.top, width: drag.width }} suppress={suppressClick} />, document.body)}

      {keysHost && createPortal(
        focusItem ? <>
          {stageStep(focusItem.stage, -1) && <span><Keys k={["←"]} />{label(stageStep(focusItem.stage, -1)!)}</span>}
          {stageStep(focusItem.stage, 1) && <span><Keys k={["→"]} />{label(stageStep(focusItem.stage, 1)!)}</span>}
        </> : <span><Keys k={["←", "→"]} />stage</span>, keysHost)}
    </>
  );
}

/* ---------------------------------------------------------------- the card */

const days = (iso: string, now: Date) => {
  const t = agoShort(iso, now);
  const m = t.match(/^(\d+) (days?)$/);
  return m ? <>{m[1]}<span className="u"> {m[2]}</span></> : <>Today</>;
};
const Cell = ({ k, children, cls }: { k: string; children: React.ReactNode; cls?: string }) => <span className={`cell${cls ? " " + cls : ""}`}><span className="k">{k}</span><span className="v">{children}</span></span>;

interface CardProps {
  item: Item; now: Date; latest?: ShipLogEntry; silent: boolean; prs: { open: number; merged: number; total: number };
  focused?: boolean; flashed?: boolean; slot?: boolean; ghost?: boolean; lift?: string; style?: React.CSSProperties;
  onFocus?: () => void; onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void; onStage?: (to: Stage) => void; suppress: React.MutableRefObject<boolean>;
}

/* Three or four earned lines, each figure under its label in a strip below one hairline: Score and Waiting in Idea; Score, Open PRs, Merged and In build in Building;
   the latest result, Logging when silent, and days live in Live. Pull request counts come from the work links and are left out when a build has none. */
const Card = forwardRef<HTMLElement, CardProps>(function Card({ item, now, latest, silent, prs, focused, flashed, slot, ghost, lift, style, onFocus, onPointerDown, onStage, suppress }, ref) {
  const s = score(item);
  const href = `/item/${item.id}`;
  const stage = item.stage;
  const unscored = s == null;
  return (
    <article ref={ref} className={`card${slot ? " is-slot" : ""}${ghost ? " ghost" : ""}`} data-row={ghost ? undefined : item.id} data-stage={stage} tabIndex={ghost || slot ? -1 : 0}
      aria-label={`${item.title}, ${label(stage)}`} data-focus={focused || undefined} data-flash={flashed || undefined} data-lift={lift} style={style}
      onFocus={onFocus} onMouseEnter={onFocus} onPointerDown={onPointerDown}
      onClick={(e) => { if (ghost || suppress.current || (e.target as HTMLElement).closest("a, select, .stage-ctl")) return; navigate(href); }}>
      <div><a className="t" href={href} onClick={linkClick(href)} tabIndex={-1}>{item.title}</a></div>
      <div className="r2">
        <span className="team"><Team name={item.team} /></span>
        {stage !== "idea" && (item.owner ? <span className="who"><Avatar name={item.owner} size="sm" />{item.owner}</span> : <span className="who none">No owner</span>)}
      </div>
      <div className="strip">
        {stage === "idea" && <>
          <Cell k="Score" cls={unscored ? "word pale" : ""}>{unscored ? "None" : fmtScore(s!)}</Cell>
          <Cell k="Waiting" cls="end">{days(item.stage_changed_at, now)}</Cell>
        </>}
        {stage === "building" && <>
          <Cell k="Score" cls={unscored ? "word pale" : ""}>{unscored ? "None" : fmtScore(s!)}</Cell>
          {prs.total > 0 && <Cell k="Open PRs" cls={prs.open ? "" : "pale"}>{prs.open}</Cell>}
          {prs.total > 0 && <Cell k="Merged" cls={`${prs.merged ? "" : "pale"} wide-only`}>{prs.merged}</Cell>}
          <Cell k="In build" cls="end">{days(item.stage_changed_at, now)}</Cell>
        </>}
        {stage === "live" && <>
          {latest ? <Cell k={latest.metric} cls={`grow${silent ? " pale" : ""}`}>{fmtNum(latest.value)}<span className="u">{latest.unit === "%" ? "%" : ` ${latest.unit}`}</span></Cell>
            : <Cell k="Result" cls="grow word pale">None</Cell>}
          {silent && <Cell k="Logging" cls="word strong">Silent</Cell>}
          <Cell k="Live" cls="end">{days(item.live_at ?? item.stage_changed_at, now)}</Cell>
        </>}
        {!ghost && !slot && (
          <label className="stage-ctl"><span className="sr-only">Stage of {item.title}</span>
            <select className="select" value={stage} onChange={(e) => onStage?.(e.target.value as Stage)}>
              {FLOW.map((x) => <option key={x} value={x}>{label(x)}</option>)}
            </select>
          </label>
        )}
      </div>
    </article>
  );
});

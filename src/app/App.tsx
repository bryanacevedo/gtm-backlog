import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { OPEN, TEAMS } from "../shared/domain";
import { MoveDialog, NewRequest, type PendingMove } from "./forms";
import { isTyping, linkClick, navigate, parseRoute, useLocation } from "./lib";
import { actorPrompt, load, setActor, useStore } from "./store";
import { Avatar, Dialog, Icon, Keys, Team, Toasts } from "./ui";
import { Board } from "./views/Board";
import { ItemPage } from "./views/ItemPage";
import { Queue } from "./views/Queue";
import { Shipped } from "./views/Shipped";
import { Triage } from "./views/Triage";

const NAV = [
  { key: "1", view: "triage", path: "/triage", name: "Triage", icon: Icon.inbox },
  { key: "2", view: "queue", path: "/", name: "Queue", icon: Icon.list },
  { key: "3", view: "board", path: "/board", name: "Board", icon: Icon.board },
  { key: "4", view: "shipped", path: "/shipped", name: "Shipped", icon: Icon.ship },
] as const;

export interface Shared { openNew: () => void; requestMove: (p: PendingMove) => void }

export function App() {
  const loc = useLocation();
  const [path, qs] = loc.split("?");
  const route = parseRoute(path);
  const activeTeam = new URLSearchParams(qs ?? "").get("team");
  const data = useStore((s) => s.data);
  const loadError = useStore((s) => s.loadError);
  const actor = useStore((s) => s.actor);
  useStore(() => actorPrompt.open);
  const [newOpen, setNewOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [nameEditing, setNameEditing] = useState(false);

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const items = data?.items ?? [];
    return {
      triage: items.filter((i) => i.stage === "triage").length,
      queue: items.filter((i) => OPEN.includes(i.stage)).length,
      board: items.filter((i) => ["idea", "building", "live"].includes(i.stage)).length,
      shipped: items.filter((i) => i.live_at).length,
      teams: TEAMS.map((t) => [t, items.filter((i) => OPEN.includes(i.stage) && i.team === t).length] as const).filter(([, n]) => n > 0),
    };
  }, [data]);

  const openNew = useCallback(() => setNewOpen(true), []);
  const shared: Shared = useMemo(() => ({ openNew, requestMove: setPending }), [openNew]);
  const overlay = newOpen || keysOpen || !!pending || actorPrompt.open || nameEditing;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlay || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const nav = NAV.find((n) => n.key === e.key);
      if (nav) { e.preventDefault(); navigate(nav.path); return; }
      if (e.key === "c") { e.preventDefault(); setNewOpen(true); }
      if (e.key === "?") { e.preventDefault(); setKeysOpen(true); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay]);

  useEffect(() => {
    const name = route.view === "item" ? data?.items.find((i) => i.id === route.id)?.title : NAV.find((n) => n.view === route.view)?.name;
    document.title = name ? `${name} · gtm-backlog` : "gtm-backlog";
  }, [route, data]);

  const keyHints: Record<string, [string[], string][]> = {
    queue: [[["j", "k"], "move"], [["↵"], "open"]],
    board: [[["j", "k"], "move"], [["←", "→"], "change stage"], [["↵"], "open"]],
    triage: [[["j", "k"], "next request"], [["a"], "accept"], [["m"], "merge"], [["d"], "decline"]],
    item: [[["←", "→"], "change stage"], [["Esc"], "back"]],
    shipped: [],
  };

  return (
    <div className="shell">
      <a className="sr-only" href="#main">Skip to content</a>
      <nav className="rail" aria-label="Workspace">
        <div className="ws"><span className="ws-mark" aria-hidden="true"><i /></span>Acme GTM</div>
        <button className="new-btn" type="button" onClick={openNew} aria-label="New request"><Icon.plus /><span>New request</span><kbd>C</kbd></button>
        {NAV.map((n) => (
          <a key={n.view} href={n.path} className="nav-link" aria-current={route.view === n.view && !(n.view === "queue" && activeTeam) ? "page" : undefined} onClick={linkClick(n.path)}>
            <n.icon /><span>{n.name}</span>
            {data && <span className="count">{counts[n.view]}</span>}
          </a>
        ))}
        {counts.teams.length > 0 && <div className="rail-group">Teams</div>}
        {counts.teams.map(([t, n]) => {
          const to = `/?team=${encodeURIComponent(t)}`;
          return (
            <a key={t} href={to} className="team-link" aria-current={route.view === "queue" && activeTeam === t ? "true" : undefined} onClick={linkClick(to)}>
              <Team name={t} /><span className="count">{n}</span>
            </a>
          );
        })}
        <div className="rail-foot">
          <button className="me" type="button" onClick={() => setNameEditing(true)}>
            <Avatar name={actor} size="sm" />
            <span>{actor ?? "Add your name"}</span>
            <span className="hint">{actor ? "Change" : ""}</span>
          </button>
        </div>
      </nav>

      <div className="main">
        {data?.meta.demo && (
          <div className="demo-band"><b>Demo workspace.</b> Sample data for a made-up GTM team. Edit anything; it resets every night.</div>
        )}
        <main id="main" className={`page${route.view === "triage" ? " full" : ""}`} tabIndex={-1} key={route.view === "item" ? `item-${route.id}` : route.view}>
          {loadError ? (
            <div className="load-error"><p>{loadError}</p><button className="btn quiet" type="button" onClick={load}>Try again</button></div>
          ) : !data ? (
            <div className="skeleton" aria-label="Loading…">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
          ) : route.view === "item" ? <ItemPage id={route.id} shared={shared} />
            : route.view === "board" ? <Board shared={shared} />
            : route.view === "triage" ? <Triage shared={shared} />
            : route.view === "shipped" ? <Shipped />
            : <Queue shared={shared} />}
        </main>
        {route.view !== "triage" && (
          <footer className="keys-foot" aria-label="Keyboard shortcuts">
            {keyHints[route.view].map(([k, d]) => <span key={d}><Keys k={k} />{d}</span>)}
            <span><Keys k={["1", "2", "3", "4"]} />views</span>
            <span><Keys k={["c"]} />new request</span>
            <span><Keys k={["?"]} />all keys</span>
          </footer>
        )}
      </div>

      {newOpen && <NewRequest onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); navigate("/triage"); }} />}
      {pending && <MoveDialog pending={pending} onClose={() => setPending(null)} />}
      {(actorPrompt.open || nameEditing) && <NameDialog initial={actor ?? ""} onDone={(n) => { setNameEditing(false); setActor(n); }} />}
      {keysOpen && (
        <Dialog title="Keyboard shortcuts" onClose={() => setKeysOpen(false)}>
          <div className="keys-table">
            {([
              [["1", "2", "3", "4"], "Triage, Queue, Board, Shipped"], [["j", "k"], "Next and previous"],
              [["↵"], "Open the focused item"], [["←", "→"], "Move the focused card between stages"],
              [["a", "m", "d"], "Accept, merge or decline a request in Triage"],
              [["c"], "New request"], [["Esc"], "Close, cancel, or back"], [["?"], "This list"],
            ] as [string[], string][]).map(([k, d]) => (
              <Fragment key={d}><span className="k"><Keys k={k} /></span><span>{d}</span></Fragment>
            ))}
          </div>
        </Dialog>
      )}
      <Toasts />
    </div>
  );
}

function NameDialog({ initial, onDone }: { initial: string; onDone: (n: string | null) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Dialog title="Who is making changes?" sub="Your name goes on the activity log next to what you change. It stays in this browser." onClose={() => onDone(null)}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onDone(name.trim()); }} style={{ display: "grid", gap: 16 }}>
        <div className="field">
          <label htmlFor="who-name">Your name</label>
          <input id="who-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Moreno" />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn quiet" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>Continue</button>
        </div>
      </form>
    </Dialog>
  );
}

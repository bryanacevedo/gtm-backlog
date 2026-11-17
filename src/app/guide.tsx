/* The demo notice (a slim bar, dismissible for the session) and the Guide: where to start, the two short paths and the plain words. */

import { useState } from "react";
import { BUYER_PATH, DEMO_NOTICE, HIRING_PATH, VALUE_LINE, VIEW_WORDS, buyerNextStep, wordsFor } from "../shared/words";
import { navigate } from "./lib";
import { Dialog } from "./ui";

const KEY = "gtm-demo-bar-hidden";
const read = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
const write = () => { try { sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked: it comes back on the next load */ } };

export function DemoBar({ onGuide }: { onGuide: () => void }) {
  const [hidden, setHidden] = useState(read);
  if (hidden) return null;
  return (
    <div className="demo-bar" role="region" aria-label="About this demo">
      <span className="demo-tag">Demo</span>
      <span className="demo-text">{DEMO_NOTICE}</span>
      <button className="btn text compact" type="button" onClick={onGuide}>Start here</button>
      <button className="btn text compact" type="button" onClick={() => { write(); setHidden(true); }} aria-label="Hide this notice for the session">Hide</button>
    </div>
  );
}

export function Guide({ onClose, demo }: { onClose: () => void; demo: boolean }) {
  const next = buyerNextStep();
  const go = (path: string) => { onClose(); navigate(path); };
  return (
    <Dialog title="Start here" onClose={onClose} closeButton>
      <div className="guide">
        <p className="guide-lead">{VALUE_LINE}</p>
        <p className="guide-first"><b>First step:</b> <button className="btn primary compact" type="button" onClick={() => go("/triage")}>Open Triage</button> to decide on the requests waiting there.</p>
        {demo && <>
          <h3>If you are hiring</h3>
          <ol>{HIRING_PATH.map((s) => <li key={s}>{s}</li>)}</ol>
          <h3>If you are buying</h3>
          <ol>{BUYER_PATH.map((s) => <li key={s}>{s}</li>)}</ol>
          {next && <p className="guide-next"><b>Next step:</b> {next}</p>}
        </>}
        <h3>The 4 screens</h3>
        <dl>{VIEW_WORDS.map((v) => <div key={v.name}><dt>{v.name}</dt><dd>{v.line}</dd></div>)}</dl>
        <h3>The words used here</h3>
        <dl>{wordsFor(demo).map((w) => <div key={w.term}><dt>{w.term}</dt><dd>{w.line}</dd></div>)}</dl>
      </div>
    </Dialog>
  );
}

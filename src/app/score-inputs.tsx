/* The four score inputs, one set for Triage and the item page (design review F25, direction A): Impact and Confidence are the
   toggles the app already uses, Reach and Effort are typed mono numbers with their unit. When a proposal exists each input shows
   its one-line reason, says plainly when it is a guess, and shows what was proposed once the value has been changed. */

import { useEffect, useId, useState, type ReactNode } from "react";
import { CONFIDENCE, IMPACT_RUBRIC, SCORE_HELP, type ScoreWord } from "../shared/domain";
import { FIELD_WORD, reasonOf, type Proposal, type ScoreField } from "../shared/scoring";
import { Tip } from "./ui";

export type Draft = { impact: number; reach: number; confidence: number; effort_days: number };

/** The toggles: one pressed value, each a labelled radio, in the accent when chosen. */
export function Checks({ label, word, options, value, onChange, trail }: { label: string; word: ScoreWord; options: { v: number; text: string; title?: string }[]; value: number; onChange: (v: number) => void; trail?: ReactNode }) {
  const name = useId();
  return (
    <div className="checks" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.v} className="check" title={o.title}>
          <input type="radio" name={name} checked={o.v === value} onChange={() => onChange(o.v)} aria-label={`${label} ${o.title ?? o.text}`} />{o.text}
        </label>
      ))}
      {trail}
    </div>
  );
}

/** A typed number: accepts 140, 2.5, 1,200; says why when it cannot be used, and does not commit it. */
export function NumField({ label, value, min, minExclusive, unit, onCommit, onValid }: { label: string; value: number; min: number; minExclusive?: boolean; unit: string; onCommit: (v: number) => void; onValid: (ok: boolean) => void }) {
  const [text, setText] = useState(String(value));
  const parse = (t: string) => { const n = Number(t.replace(/,/g, "").trim()); return t.trim() === "" || !Number.isFinite(n) ? null : n; };
  const ok = (n: number | null): n is number => n != null && (minExclusive ? n > min : n >= min);
  const cur = parse(text);
  const bad = !ok(cur);
  // A value that arrives from outside (the proposal landing, a reset) replaces the text; one that matches what is typed does not.
  useEffect(() => { if (parse(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onValid(!bad); return () => onValid(true); }, [bad]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="num-in">
      <input className="input mono" inputMode="decimal" autoComplete="off" spellCheck={false} aria-label={label} value={text} aria-invalid={bad || undefined}
        onChange={(e) => { setText(e.target.value); const n = parse(e.target.value); if (ok(n)) onCommit(n); }}
        onBlur={() => { if (!bad) setText(String(cur)); }} />
      <span className="u">{unit}</span>
      {bad && <span className="error-text" role="alert">{minExclusive ? `More than ${min}` : `${min} or more`}</span>}
    </span>
  );
}

const CONF = CONFIDENCE.map((v) => ({ v, text: `${v}%` }));
const IMPACT = [1, 2, 3, 4, 5].map((v) => ({ v, text: String(v), title: IMPACT_RUBRIC[v] }));

/** All four rows. `proposal` is optional: with it each row carries its reason and its guess flag. */
export function ScoreInputs({ value, onChange, onValid, proposal }: { value: Draft; onChange: (d: Draft) => void; onValid: (field: ScoreField, ok: boolean) => void; proposal?: Proposal | null }) {
  const row = (field: ScoreField, word: ScoreWord, control: ReactNode) => {
    const guess = proposal?.guesses.includes(field);
    const was = proposal && proposal[field] !== value[field] ? proposal[field] : null;
    return (
      <div className="in-row wide" key={field}>
        <span className="lab"><Tip lines={SCORE_HELP[word]}>{FIELD_WORD[field]}</Tip></span>
        <div className="in-ctl">
          {control}
          {proposal && (
            <span className="why">
              {guess && <b>Guess. </b>}{reasonOf(proposal, field)}
              {was != null && <span className="was"> Proposed {was}{field === "confidence" ? "%" : ""}.</span>}
            </span>
          )}
        </div>
      </div>
    );
  };
  return (<>
    {row("impact", "impact", <Checks label="Impact" word="impact" options={IMPACT} value={value.impact} onChange={(v) => onChange({ ...value, impact: v })} trail={<span className="rub">{IMPACT_RUBRIC[value.impact]}</span>} />)}
    {row("reach", "reach", <NumField label="Reach" value={value.reach} min={0} unit="accounts / wk" onCommit={(v) => onChange({ ...value, reach: v })} onValid={(ok) => onValid("reach", ok)} />)}
    {row("confidence", "confidence", <Checks label="Confidence" word="confidence" options={CONF} value={value.confidence} onChange={(v) => onChange({ ...value, confidence: v })} />)}
    {row("effort_days", "effort", <NumField label="Effort" value={value.effort_days} min={0} minExclusive unit={value.effort_days === 1 ? "day" : "days"} onCommit={(v) => onChange({ ...value, effort_days: v })} onValid={(ok) => onValid("effort_days", ok)} />)}
  </>);
}

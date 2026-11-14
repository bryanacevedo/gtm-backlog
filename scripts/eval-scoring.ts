/* Eval of proposed scores against scores a person settled on. Every scored item is proposed to leave-one-out (its own scores are
   never in the examples), then compared with what it was given. Reports per input: exact matches, mean distance, and how well the
   resulting ranking agrees. A constant "same values for everything" baseline is printed beside it, since that is what triage had.

   Usage (the key comes from the environment, never from this file; nothing is printed but the figures):
     ANTHROPIC_API_KEY=... node scripts/eval-scoring.ts [--model claude-haiku-5-5] [--limit 30] [--real DATABASE_URL_VARIABLE_NAME]
   Without --real it scores the demo's sample items. With --real it reads the items table (SELECT only) of that database. */

import { migrate, pglite, postgresJs, type Db } from "../src/server/db.ts";
import { seedSql } from "../src/server/seed.ts";
import { DEFAULT_MODEL, makeClient, proposeWithClaude, type Example } from "../src/server/scoring.ts";
import { readdirSync, readFileSync } from "node:fs";
import { score } from "../src/shared/domain.ts";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const model = arg("model") ?? DEFAULT_MODEL, limit = Number(arg("limit") ?? 60), realVar = arg("real");
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("Set ANTHROPIC_API_KEY."); process.exit(1); }

type Row = { id: string; title: string; problem: string; team: string; requester: string; touches: string[]; link: string | null; impact: number; reach: number; confidence: number; effort_days: number };
let db: Db;
if (realVar) {
  const url = process.env[realVar];
  if (!url) { console.error(`${realVar} is not set.`); process.exit(1); }
  db = await postgresJs(url, { max: 1 });
} else {
  db = await pglite();
  const dir = new URL("../migrations/", import.meta.url);
  await migrate(db, readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: readFileSync(new URL(name, dir), "utf8") })));
  await db.exec(seedSql());
}
const rows = (await db.query<Row>(
  `SELECT id, title, problem, team, requester, touches, link, impact, reach, confidence, effort_days FROM items
    WHERE impact IS NOT NULL AND reach IS NOT NULL AND confidence IS NOT NULL AND effort_days IS NOT NULL AND stage::text <> 'triage' ORDER BY created_at`)).slice(0, limit);
await db.close();
console.log(`Items scored by a person: ${rows.length}. Model: ${model}. Source: ${realVar ? "the real backlog (read only)" : "demo sample"}.`);

const toExample = (r: Row): Example => ({ title: r.title, problem: r.problem, team: r.team, touches: r.touches, final: { impact: r.impact, reach: r.reach, confidence: r.confidence, effort_days: r.effort_days } });
const client = makeClient(key);
const got: { r: Row; p: { impact: number; reach: number; confidence: number; effort_days: number }; guesses: string[] }[] = [];
let cacheRead = 0, cacheWrite = 0, input = 0, output = 0;
for (const r of rows) {
  const examples = rows.filter((x) => x.id !== r.id).slice(-14).map(toExample);
  try {
    const m = await proposeWithClaude(client, r, examples, model);
    got.push({ r, p: m.drafted, guesses: m.drafted.guesses });
    cacheRead += m.usage?.cacheRead ?? 0; cacheWrite += m.usage?.cacheWrite ?? 0; input += m.usage?.input ?? 0; output += m.usage?.output ?? 0;
  } catch (e) { console.error(`${r.id}: ${(e as Error).message}`); }
}

const FIELDS = ["impact", "reach", "confidence", "effort_days"] as const;
const BASE = { impact: 3, reach: 25, confidence: 80, effort_days: 3 };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
function rankOf(v: number[]) { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = Array(v.length).fill(0); o.forEach(([, i], k) => { r[i] = k; }); return r; }
function spearman(a: number[], b: number[]) { const x = rankOf(a), y = rankOf(b), mx = mean(x), my = mean(y); const num = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0); const d = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0)); return d ? num / d : 0; }

function report(label: string, pick: (g: (typeof got)[number]) => typeof BASE) {
  console.log(`\n${label}`);
  for (const f of FIELDS) {
    const d = got.map((g) => ({ was: pick(g)[f], now: g.r[f] }));
    const exact = d.filter((x) => x.was === x.now).length;
    const abs = d.map((x) => Math.abs(x.was - x.now));
    const rel = d.map((x) => (x.now ? Math.abs(x.was - x.now) / x.now : 0));
    console.log(`  ${f.padEnd(12)} exact ${exact}/${d.length}  mean off ${mean(abs).toFixed(f === "impact" ? 2 : 1)}  ${f === "impact" || f === "confidence" ? "" : `median off ${(median(rel) * 100).toFixed(0)}%`}`);
  }
  const unchanged = got.filter((g) => FIELDS.every((f) => pick(g)[f] === g.r[f])).length;
  const s1 = got.map((g) => score(pick(g)) ?? 0), s2 = got.map((g) => score(g.r) ?? 0);
  console.log(`  all four exact ${unchanged}/${got.length} (the share Accept would take as is)  rank agreement (Spearman) ${spearman(s1, s2).toFixed(2)}`);
}
report("Proposed by the model", (g) => g.p);
report("Baseline: the same starting values for every item", () => BASE);
const guessed = got.flatMap((g) => g.guesses.map((f) => ({ f, ok: g.p[f as (typeof FIELDS)[number]] === g.r[f as (typeof FIELDS)[number]] })));
console.log(`\nValues the model called a guess: ${guessed.length} of ${got.length * 4}; of those, exact ${guessed.filter((x) => x.ok).length}.`);
console.log(`Tokens: input ${input}, output ${output}, cache read ${cacheRead}, cache write ${cacheWrite}.`);

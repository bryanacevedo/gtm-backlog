/* Proposed scores: checked on the way in, stored apart from what is accepted, learned from, never sent from the demo. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { migrate, pglite, postgresJs, type Db } from "../src/server/db";
import { PROMPT_VERSION, RUBRIC, loadExamples, standIn, examplesText, type ScoringClient } from "../src/server/scoring";
import { checkDrafted, trustOf, type Proposal } from "../src/shared/scoring";
import { allMigrations } from "./migrations";

const good = { impact: 4, reach: 60, confidence: 80, effort_days: 3, reasons: { impact: "Speed to lead.", reach: "About 60 accounts a week.", confidence: "A stated volume.", effort_days: "One sync job." }, guesses: ["reach"] };

describe("checkDrafted", () => {
  it("accepts a good answer and tidies it", () => {
    const r = checkDrafted({ ...good, effort_days: 2.3, reach: 59.6, impact: 3.8 });
    expect("value" in r && r.value).toMatchObject({ impact: 4, reach: 60, effort_days: 2.5, guesses: ["reach"] });
  });
  it("refuses what cannot be used", () => {
    for (const bad of [{ ...good, impact: 9 }, { ...good, confidence: 90 }, { ...good, reach: -1 }, { ...good, effort_days: 0 }, { ...good, reasons: { ...good.reasons, reach: "" } }, null, "x"]) expect("error" in checkDrafted(bad)).toBe(true);
  });
  it("keeps dashes out of a reason", () => {
    const r = checkDrafted({ ...good, reasons: { ...good.reasons, impact: "Fast — and cheap" } });
    expect("value" in r && r.value.reasons.impact).toBe("Fast , and cheap");
  });
});

const prop = (o: Partial<Proposal>): Proposal => ({ id: "x", item_id: "i", impact: 3, reach: 100, confidence: 80, effort_days: 4, reason_impact: "", reason_reach: "", reason_confidence: "", reason_effort: "", guesses: [], source: "claude", model: "m", prompt_version: "v1", examples_used: 0, created_at: "", resolved_at: "t", outcome: "accepted", accepted_impact: 3, accepted_reach: 100, accepted_confidence: 80, accepted_effort_days: 4, ...o });
describe("trustOf", () => {
  it("counts accepted-unchanged and drift per input, and ignores declined ones", () => {
    const t = trustOf([prop({}), prop({ outcome: "adjusted", accepted_impact: 4, accepted_reach: 150 }), prop({ outcome: "declined", accepted_impact: null }), prop({ resolved_at: null, outcome: null })]);
    expect(t.decided).toBe(2); expect(t.unchanged).toBe(1);
    expect(t.drift.impact).toEqual({ changed: 1, mean: 0.5, unit: "points" });
    expect(t.drift.reach.changed).toBe(1); expect(t.drift.reach.mean).toBe(25);
    expect(t.drift.confidence.changed).toBe(0);
  });
});

/* ------------------------------------------------------------------ the API */

let db: Db;
beforeAll(async () => {
  // TEST_DATABASE_URL runs the same tests on the network driver the real space uses.
  if (process.env.TEST_DATABASE_URL) { db = await postgresJs(process.env.TEST_DATABASE_URL); await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); } else db = await pglite();
  await migrate(db, allMigrations());
});
afterAll(() => db.close());

const H = { "content-type": "application/json", "x-actor": "Bryan" };
const mk = async (app: ReturnType<typeof createApp>, title = "Alert when a champion leaves") => {
  const res = await app.request("/api/items", { method: "POST", headers: H, body: JSON.stringify({ title, problem: "We hear about job changes months late and lose the thread with a champion.", team: "Sales", requester: "Ava", touches: ["pipeline"] }) });
  return ((await res.json()) as { item: { id: string } }).item.id;
};
const fakeClient = (answer = good) => {
  const create = vi.fn(async (_req?: unknown) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
  return { client: { messages: { create } } as unknown as ScoringClient, create };
};
const get = async (app: ReturnType<typeof createApp>, id: string) => (await (await app.request(`/api/items/${id}/proposal`)).json()) as { proposal: Proposal | null; error?: string };
const accept = async (app: ReturnType<typeof createApp>, id: string, patch: object) => {
  await app.request(`/api/items/${id}`, { method: "PATCH", headers: H, body: JSON.stringify(patch) });
  return app.request(`/api/items/${id}/move`, { method: "POST", headers: H, body: JSON.stringify({ to: "idea" }) });
};

describe("proposals in the real space", () => {
  it("asks the model once, stores the proposal with its model and version, and caches the rubric and examples", async () => {
    const { client, create } = fakeClient();
    const app = createApp(() => db, { demo: false, scoring: { client, model: "claude-haiku-5-5" } });
    const id = await mk(app);
    await new Promise((r) => setTimeout(r, 50)); // the arrival proposal runs in the background
    const a = await get(app, id), b = await get(app, id);
    expect(a.proposal).toMatchObject({ impact: 4, reach: 60, confidence: 80, effort_days: 3, source: "claude", model: "claude-haiku-5-5", prompt_version: PROMPT_VERSION, guesses: ["reach"], reason_reach: "About 60 accounts a week." });
    expect(b.proposal?.id).toBe(a.proposal?.id);
    expect(create).toHaveBeenCalledTimes(1);
    const req = create.mock.calls[0][0] as unknown as { model: string; system: { text: string; cache_control?: unknown }[]; output_config: { format: { type: string } }; messages: { content: string }[] };
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system[0].text).toBe(RUBRIC);
    expect(req.system.every((b) => (b.cache_control as { type: string }).type === "ephemeral")).toBe(true);
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.messages[0].content).toContain("Alert when a champion leaves");
    // the item's own scores are untouched: a proposal is not a score
    const item = await db.query<{ impact: number | null }>("SELECT impact FROM items WHERE id = $1", [id]);
    expect(item[0].impact).toBeNull();
  });

  it("marks a proposal accepted when taken as proposed, adjusted when changed, and learns from both", async () => {
    const { client, create } = fakeClient();
    const app = createApp(() => db, { demo: false, scoring: { client } });
    const one = await mk(app, "Proposal accepted as is"), two = await mk(app, "Proposal adjusted");
    await get(app, one); await get(app, two);
    expect((await accept(app, one, { impact: 4, reach: 60, confidence: 80, effort_days: 3 })).status).toBe(200);
    expect((await accept(app, two, { impact: 2, reach: 60, confidence: 50, effort_days: 3 })).status).toBe(200);
    const rows = await db.query<{ item_id: string; outcome: string; accepted_impact: number; impact: number }>("SELECT item_id, outcome, accepted_impact, impact FROM score_proposals WHERE item_id IN ($1, $2)", [one, two]);
    expect(rows.find((r) => r.item_id === one)).toMatchObject({ outcome: "accepted", accepted_impact: 4, impact: 4 });
    expect(rows.find((r) => r.item_id === two)).toMatchObject({ outcome: "adjusted", accepted_impact: 2, impact: 4 }); // the proposal still says 4
    const ex = await loadExamples(db);
    expect(ex.some((e) => e.title === "Proposal adjusted" && e.was?.impact === 4 && e.final.impact === 2)).toBe(true);
    expect(examplesText(ex)).toContain("changed it to the final scores");
    // the next request's prompt carries those examples
    const three = await mk(app, "Next request");
    create.mockClear(); await get(app, three);
    const sys = (create.mock.calls[0][0] as unknown as { system: { text: string }[] }).system;
    expect(sys[1].text).toContain("Proposal adjusted");
  });

  it("says so plainly when there is no key or the model fails, and never blocks the request", async () => {
    const none = createApp(() => db, { demo: false });
    const id = await mk(none, "No key");
    expect(await get(none, id)).toMatchObject({ proposal: null, error: expect.stringMatching(/not set up/) });
    const broken = createApp(() => db, { demo: false, scoring: { client: { messages: { create: async () => { throw new Error("boom"); } } } as unknown as ScoringClient } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id2 = await mk(broken, "Fails");
    expect(await get(broken, id2)).toMatchObject({ proposal: null, error: expect.stringMatching(/Could not propose/) });
  });

  it("refuses an answer the model got wrong", async () => {
    const { client } = fakeClient({ ...good, impact: 9 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp(() => db, { demo: false, scoring: { client } });
    const id = await mk(app, "Bad answer");
    expect((await get(app, id)).proposal).toBeNull();
  });
});

describe("proposals in the demo", () => {
  it("uses a stand-in, labelled as one, and never calls the model even when a key is set", async () => {
    const { client, create } = fakeClient();
    const app = createApp(() => db, { demo: true, scoring: { client } });
    const id = await mk(app, "Clean job titles for segmentation");
    const r = await get(app, id);
    expect(r.proposal).toMatchObject({ source: "stand-in", model: "stand-in" });
    expect(create).not.toHaveBeenCalled();
  });
  it("stands in with valid, reasoned values for any request", () => {
    for (const t of [[], ["pipeline"], ["data quality", "reporting"]]) {
      const d = standIn({ title: "Something new", touches: t as never, problem: "short", link: null });
      expect("value" in checkDrafted(d)).toBe(true);
    }
  });
});

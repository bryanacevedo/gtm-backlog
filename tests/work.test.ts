/* Work links: the recogniser, the API, and results from Building onward. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { migrate, pglite, type Db } from "../src/server/db";
import { canLogResults, hasWork } from "../src/shared/domain";
import { parseWorkLink, readPullRequest, stateWord, type ParsedLink } from "../src/shared/work";
import { allMigrations } from "./migrations";

const ok = (u: string) => { const r = parseWorkLink(u); if ("error" in r) throw new Error(r.error); return r as ParsedLink; };

describe("recognising a pasted link", () => {
  it("reads a GitHub repository, with or without a branch", () => {
    expect(ok("https://github.com/example/crm-dedupe")).toMatchObject({ kind: "repo", title: "example/crm-dedupe", meta: { repo: "example/crm-dedupe" } });
    expect(ok("https://github.com/example/crm-dedupe/")).toMatchObject({ kind: "repo", url: "https://github.com/example/crm-dedupe" });
    expect(ok("https://github.com/example/crm-dedupe/tree/merge-job")).toMatchObject({ kind: "repo", meta: { repo: "example/crm-dedupe", branch: "merge-job" } });
    expect(ok("https://github.com/example/crm-dedupe/tree/feat/merge-job").meta.branch).toBe("feat/merge-job");
  });
  it("reads a pull request and drops the tab, query and fragment", () => {
    expect(ok("https://github.com/example/crm-dedupe/pull/17")).toMatchObject({ kind: "pr", url: "https://github.com/example/crm-dedupe/pull/17", meta: { repo: "example/crm-dedupe", number: 17 } });
    expect(ok("https://github.com/example/crm-dedupe/pull/17/files?w=1#diff-1").url).toBe("https://github.com/example/crm-dedupe/pull/17");
  });
  it("reads a commit", () => {
    expect(ok("https://github.com/example/crm-dedupe/commit/ABCDEF1234567")).toMatchObject({ kind: "commit", meta: { sha: "abcdef1234567" }, title: "crm-dedupe@abcdef1" });
  });
  it("reads a Claude session", () => {
    expect(ok("https://claude.ai/code/session_01AbCdEf")).toMatchObject({ kind: "session", title: "Claude session", url: "https://claude.ai/code/session_01AbCdEf" });
    expect(ok("https://claude.ai/chat/3f2a9c1e-1111-2222-3333-444455556666").kind).toBe("session");
    expect(ok("https://claude.ai/code/session_01AbCdEf?x=1").url).toBe("https://claude.ai/code/session_01AbCdEf");
  });
  it("keeps any other address as a plain link, titled by where it points", () => {
    expect(ok("https://example.com/docs/partner-tagging")).toMatchObject({ kind: "doc", title: "example.com/docs/partner-tagging" });
    expect(ok("https://github.com/example/crm-dedupe/issues/3").kind).toBe("doc");
    expect(ok("https://claude.ai/settings").kind).toBe("doc");
  });
  it("refuses what is not a web link", () => {
    for (const bad of ["", "   ", "not a link", "javascript:alert(1)", "ftp://x.test/a", "https://" + "a".repeat(600) + ".com"]) expect(parseWorkLink(bad), bad.slice(0, 20)).toHaveProperty("error");
  });
  it("words a pull request's state plainly", () => {
    expect(stateWord({ state: "merged", meta: {} })).toBe("Merged");
    expect(stateWord({ state: "open", meta: { draft: true } })).toBe("Draft");
    expect(stateWord({ state: "open", meta: {} })).toBe("Open");
    expect(stateWord({ state: null, meta: {} })).toBe("");
  });
  it("reads what GitHub says about a pull request", () => {
    expect(readPullRequest({ title: "  Fix it ", state: "closed", merged_at: "2026-11-12T10:00:00Z", head: { ref: "fix" }, draft: false })).toEqual({ title: "Fix it", state: "merged", meta: { draft: false, branch: "fix", date: "2026-11-12" } });
    expect(readPullRequest({ title: "x", state: "closed", closed_at: "2026-11-01T00:00:00Z" })?.state).toBe("closed");
    expect(readPullRequest({ title: "x", state: "open", created_at: "2026-11-02T00:00:00Z", draft: true })?.meta).toMatchObject({ draft: true, date: "2026-11-02" });
    expect(readPullRequest({ message: "Not Found" })).toBeNull();
    expect(readPullRequest(null)).toBeNull();
  });
});

describe("the results rule", () => {
  it("allows results from Building onward and not before", () => {
    expect(canLogResults("building")).toBe(true);
    expect(canLogResults("live")).toBe(true);
    for (const s of ["triage", "idea", "declined", "retired"] as const) expect(canLogResults(s), s).toBe(false);
  });
  it("lists work for a building or live item, and a retired one that ran", () => {
    expect(hasWork({ stage: "building", live_at: null })).toBe(true);
    expect(hasWork({ stage: "live", live_at: "2026-11-01T00:00:00Z" })).toBe(true);
    expect(hasWork({ stage: "retired", live_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(hasWork({ stage: "idea", live_at: null })).toBe(false);
  });
});

let db: Db, app: ReturnType<typeof createApp>, github: { urls: string[]; headers: Record<string, string>[]; reply: () => Response | Promise<Response> };
const j = async (res: Response) => (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { "content-type": "application/json", "x-actor": "Sam" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  db = await pglite();
  await migrate(db, allMigrations());
  github = { urls: [], headers: [], reply: () => Response.json({ message: "Not Found" }, { status: 404 }) };
  const fakeFetch: typeof fetch = async (input, init) => { github.urls.push(String(input)); github.headers.push({ ...(init?.headers as Record<string, string>) }); return github.reply(); };
  app = createApp(() => db, { demo: false, fetch: fakeFetch, githubToken: "ghp_secret_token" });
  for (const [id, stage] of [["i_idea", "idea"], ["i_build", "building"], ["i_live", "live"]]) {
    await db.query("INSERT INTO items (id, title, problem, team, requester, stage, system_url) VALUES ($1, 't', 'p', 'Sales', 'r', $2::stage, $3)", [id, stage, stage === "live" ? "https://x.test" : null]);
  }
});
afterAll(() => db.close());

describe("POST /api/items/:id/links", () => {
  it("adds a repository and a session by their address and shows them in the state", async () => {
    const a = await call("POST", "/api/items/i_build/links", { url: "https://github.com/example/crm-dedupe/tree/merge-job" });
    expect(a.status).toBe(201);
    expect((await j(a)).link).toMatchObject({ kind: "repo", title: "example/crm-dedupe", created_by: "Sam", meta: { repo: "example/crm-dedupe", branch: "merge-job" } });
    const s = await call("POST", "/api/items/i_build/links", { url: "https://claude.ai/code/session_01abcdef", title: "Design the match rules" });
    expect((await j(s)).link).toMatchObject({ kind: "session", title: "Design the match rules" });
    const state = await j(await app.request("/api/state"));
    expect(state.workLinks.filter((l: { item_id: string }) => l.item_id === "i_build")).toHaveLength(2);
  });
  it("looks a pull request up on GitHub once, with the token, and fills its title and state", async () => {
    github.reply = () => Response.json({ title: "Reassign activity and owners", state: "closed", merged_at: "2026-11-12T09:00:00Z", head: { ref: "reassign" }, draft: false });
    const res = await call("POST", "/api/items/i_build/links", { url: "https://github.com/example/crm-dedupe/pull/17/files" });
    expect(res.status).toBe(201);
    expect((await j(res)).link).toMatchObject({ kind: "pr", title: "Reassign activity and owners", state: "merged", meta: { number: 17, branch: "reassign", date: "2026-11-12" } });
    expect(github.urls.at(-1)).toBe("https://api.github.com/repos/example/crm-dedupe/pulls/17");
    expect(github.headers.at(-1)?.authorization).toBe("Bearer ghp_secret_token");
  });
  it("falls back to the pasted address when GitHub does not answer, and never puts the token in a response or the log", async () => {
    github.reply = () => { throw new Error("offline"); };
    const res = await call("POST", "/api/items/i_build/links", { url: "https://github.com/example/crm-dedupe/pull/18" });
    expect(res.status).toBe(201);
    const text = JSON.stringify(await j(res));
    expect(text).not.toContain("ghp_secret_token");
    const link = JSON.parse(text).link;
    expect(link).toMatchObject({ kind: "pr", title: "example/crm-dedupe#18", state: null });
    const events = await db.query<{ detail: string }>("SELECT detail FROM events WHERE item_id = 'i_build'");
    expect(JSON.stringify(events)).not.toContain("ghp_secret");
    expect(events.map((e) => e.detail)).toContain("Linked pull request #18");
  });
  it("does not spend the GitHub allowance from the public demo", async () => {
    const before = github.urls.length;
    const demo = createApp(() => db, { demo: true, fetch: async (u) => { github.urls.push(String(u)); return Response.json({}); } });
    const res = await demo.request("/api/items/i_build/links", { method: "POST", headers: { "content-type": "application/json", "x-actor": "Visitor" }, body: JSON.stringify({ url: "https://github.com/example/crm-dedupe/pull/30" }) });
    expect(res.status).toBe(201);
    expect(github.urls.length).toBe(before);
  });
  it("refuses a duplicate, a bad address and an item that does not exist", async () => {
    const dup = await call("POST", "/api/items/i_build/links", { url: "https://github.com/example/crm-dedupe/pull/18?x=1" });
    expect(dup.status).toBe(409);
    expect((await call("POST", "/api/items/i_build/links", { url: "nope" })).status).toBe(400);
    expect((await call("POST", "/api/items/missing/links", { url: "https://example.com/a" })).status).toBe(404);
  });
  it("removes a link and says so in the activity", async () => {
    const added = await j(await call("POST", "/api/items/i_live/links", { url: "https://example.com/runbook" }));
    expect((await call("DELETE", `/api/items/i_live/links/${added.link.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/items/i_live/links/${added.link.id}`)).status).toBe(404);
    const [e] = await db.query<{ detail: string }>("SELECT detail FROM events WHERE item_id = 'i_live' ORDER BY at DESC LIMIT 1");
    expect(e.detail).toMatch(/^Removed the link example\.com\/runbook/);
  });
});

describe("the database holds the rules too", () => {
  it("refuses a state on anything but a pull request, an unknown kind, and the same link twice", async () => {
    const ins = (id: string, kind: string, url: string, state: string | null) =>
      db.query("INSERT INTO work_links (id, item_id, kind, url, title, state, created_by) VALUES ($1, 'i_idea', $2, $3, 't', $4, 'x')", [id, kind, url, state]);
    await expect(ins("a", "repo", "https://x.test/1", "open")).rejects.toThrow(/state_only_on_pr/);
    await expect(ins("b", "video", "https://x.test/2", null)).rejects.toThrow();
    await expect(ins("c", "pr", "https://x.test/3", "draft")).rejects.toThrow();
    await ins("d", "pr", "https://x.test/4", "merged");
    await expect(ins("e", "pr", "https://x.test/4", "merged")).rejects.toThrow(/one_link_per_item/);
  });
});

describe("POST /api/items/:id/log", () => {
  const entry = { metric: "Duplicate accounts found", value: 1284, unit: "accounts", date: "2026-11-12" };
  it("takes a result from a building item", async () => {
    const res = await call("POST", "/api/items/i_build/log", entry);
    expect(res.status).toBe(201);
    expect((await j(res)).entry).toMatchObject({ item_id: "i_build", value: 1284 });
  });
  it("still takes one from a live item", async () => {
    expect((await call("POST", "/api/items/i_live/log", entry)).status).toBe(201);
  });
  it("refuses one before the build starts, and says where results are logged", async () => {
    const res = await call("POST", "/api/items/i_idea/log", entry);
    expect(res.status).toBe(409);
    expect((await j(res)).error).toMatch(/building or live/);
  });
});

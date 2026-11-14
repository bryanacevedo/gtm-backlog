/* Load cost: how many database round trips a page load makes, the settings cache, the Server-Timing header, the query time limit. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { migrate, pglite, withLimit, type Db } from "../src/server/db";
import { allMigrations } from "./migrations";

let db: Db, texts: string[];
/** The same database, counting every query that reaches it. */
const counted = (inner: Db): Db => ({ ...inner, query: (text, params) => { texts.push(text); return inner.query(text, params); } });
const body = (key: string, value: unknown) => ({ method: "PUT", headers: { "content-type": "application/json", "x-actor": "Bryan" }, body: JSON.stringify({ key, value }) });
const accentOf = async (app: ReturnType<typeof createApp>) => ((await (await app.request("/api/state")).json()) as { meta: { settings: { accent: string } } }).meta.settings.accent;

beforeAll(async () => { db = await pglite(); await migrate(db, allMigrations()); });
afterAll(() => db.close());
afterEach(() => { vi.useRealTimers(); texts = []; });

describe("/api/state round trips", () => {
  it("makes five queries cold and four warm (settings and photos share one read)", async () => {
    const c = counted(db); // one wrapper, so the cache key is stable
    const app2 = createApp(() => c, { demo: true, resolve: async () => ({ db: c, demo: true }) });
    texts = [];
    expect((await app2.request("/api/state")).status).toBe(200);
    expect(texts.length).toBeLessThanOrEqual(5);
    expect(texts.filter((t) => t.includes("FROM settings")).length).toBe(1);
    texts = [];
    await app2.request("/api/state");
    expect(texts.length).toBeLessThanOrEqual(4);
  });
  it("sends Server-Timing with the total and the query count", async () => {
    const c = counted(db);
    const app = createApp(() => c, { demo: true, resolve: async () => ({ db: c, demo: true }), settingsTtlMs: 0 });
    const h = (await app.request("/api/state")).headers.get("server-timing") ?? "";
    expect(h).toMatch(/^total;dur=\d+(\.\d+)?, queries;desc="5"/);
    expect(h).toContain("-settings;dur=");
  });
  it("logs a warning when the load takes over 2 seconds", async () => {
    const slow: Db = { ...db, query: async (t, p) => { await new Promise((r) => setTimeout(r, 2100)); return db.query(t, p); } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createApp(() => slow, { demo: true, resolve: async () => ({ db: slow, demo: true }) });
    await app.request("/api/state");
    expect(warn.mock.calls.some((a) => String(a[0]).startsWith("Slow /api/state:"))).toBe(true);
    warn.mockRestore();
  }, 10_000);
});

describe("settings cache", () => {
  it("keeps the read for 5 seconds, then reads again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const c = counted(db);
    const app = createApp(() => c, { demo: true, resolve: async () => ({ db: c, demo: true }) });
    texts = [];
    await app.request("/api/state"); await app.request("/api/state");
    expect(texts.filter((t) => t.includes("FROM settings")).length).toBe(1);
    vi.setSystemTime(Date.now() + 4900);
    await app.request("/api/state");
    expect(texts.filter((t) => t.includes("FROM settings")).length).toBe(1);
    vi.setSystemTime(Date.now() + 200);
    await app.request("/api/state");
    expect(texts.filter((t) => t.includes("FROM settings")).length).toBe(2);
  });
  it("is dropped at once by a settings write, so the next read shows it", async () => {
    const c = counted(db);
    const app = createApp(() => c, { demo: true, resolve: async () => ({ db: c, demo: true }) });
    const before = await accentOf(app);
    await accentOf(app); // cached
    const next = before === "#1D4ED8" ? "#0F766E" : "#1D4ED8";
    expect((await app.request("/api/settings/accent", body("accent", next))).status).toBe(200);
    expect(await accentOf(app)).toBe(next);
  });
  it("is dropped by the photo endpoints too", async () => {
    const c = counted(db);
    const app = createApp(() => c, { demo: false, resolve: async () => ({ db: c, demo: false, actor: "Ana", email: "ana@example.com", meta: {} }) });
    const photos = async () => ((await (await app.request("/api/state")).json()) as { meta: { photos: Record<string, string> } }).meta.photos;
    expect(await photos()).toEqual({});
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString("base64")}`;
    await app.request("/api/me/photo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo: png }) });
    expect(await photos()).toEqual({ Ana: png });
    await app.request("/api/me/photo", { method: "DELETE" });
    expect(await photos()).toEqual({});
  });
  it("is off with a TTL of 0", async () => {
    const c = counted(db);
    const app = createApp(() => c, { demo: true, resolve: async () => ({ db: c, demo: true }), settingsTtlMs: 0 });
    texts = [];
    await app.request("/api/state"); await app.request("/api/state");
    expect(texts.filter((t) => t.includes("FROM settings")).length).toBe(2);
  });
});

describe("withLimit", () => {
  it("rejects with a plain message after the limit, without waiting for real time", async () => {
    vi.useFakeTimers();
    const stuck = withLimit(new Promise<never>(() => {}), 20_000);
    const seen = expect(stuck).rejects.toThrow("The database did not answer within 20 seconds.");
    await vi.advanceTimersByTimeAsync(19_999);
    await vi.advanceTimersByTimeAsync(2);
    await seen;
  });
  it("passes an answer through and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(withLimit(Promise.resolve(7), 1000)).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });
});

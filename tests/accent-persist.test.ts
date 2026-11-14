/* A picked accent survives a reload, in the demo and in the real space, on PGlite and (when TEST_DATABASE_URL is set) on the network driver.
   The bug: the network driver stored a JSON value twice-encoded, so the accent read back as nothing and the page fell to the default ink. */
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { migrate, pglite, postgresJs, type Db } from "../src/server/db";
import { DEFAULT_ACCENT } from "../src/shared/settings";
import { allMigrations } from "./migrations";

const hdr = { "content-type": "application/json", "x-actor": "Ana" };
type St = { meta: { settings: { accent: string; team_glyphs: Record<string, string | null> } } };
const put = (app: ReturnType<typeof createApp>, key: string, value: unknown) => app.request(`/api/settings/${key}`, { method: "PUT", headers: hdr, body: JSON.stringify({ value }) });
const read = async (app: ReturnType<typeof createApp>) => (await (await app.request("/api/state")).json()) as St;

const open: Db[] = [];
afterAll(async () => { for (const d of open) await d.close().catch(() => {}); });

/** Each "reload" is a brand-new app over the same database: no cache survives. */
function suite(name: string, make: () => Promise<Db>) {
  for (const demo of [true, false]) {
    describe(`${name}, ${demo ? "demo" : "real"} space`, () => {
      it("keeps a picked accent and glyphs across a reload, with a swatch and with a typed colour", async () => {
        const db = await make(); open.push(db);
        await migrate(db, allMigrations());
        const first = createApp(() => db, { demo });
        expect((await read(first)).meta.settings.accent).toBe(DEFAULT_ACCENT);
        for (const hex of ["#C2410C", "#1D4ED8", "#0f766e"]) {
          const res = await put(first, "accent", hex);
          expect(res.status).toBe(200);
          const want = hex.toUpperCase();
          expect((await res.json() as { settings: { accent: string } }).settings.accent).toBe(want);
          expect((await read(first)).meta.settings.accent).toBe(want);
          expect((await read(createApp(() => db, { demo, settingsTtlMs: 0 }))).meta.settings.accent).toBe(want);
        }
        expect((await put(first, "team_glyphs", { Sales: "bolt" })).status).toBe(200);
        expect((await read(createApp(() => db, { demo }))).meta.settings.team_glyphs).toEqual({ Sales: "bolt" });
      });
    });
  }
}

suite("PGlite", () => pglite());

const url = process.env.TEST_DATABASE_URL;
describe.runIf(url)("network driver (TEST_DATABASE_URL)", () => {
  suite("postgres.js", async () => {
    const db = await postgresJs(url!);
    await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    return db;
  });
});

describe("migration 0004 repairs values stored twice-encoded", () => {
  it("unwraps a string-wrapped accent, glyphs and link meta, and leaves right rows alone", async () => {
    const db = await pglite(); open.push(db);
    const all = allMigrations();
    await migrate(db, all.filter((m) => !m.name.startsWith("0004")));
    await db.query("INSERT INTO settings (key, value) VALUES ('accent', to_jsonb('\"#C2410C\"'::text)), ('team_glyphs', to_jsonb('{\"Sales\":\"bolt\"}'::text)), ('team_colors', '{\"Sales\":\"#0337DC\"}'::jsonb)");
    await migrate(db, all);
    const rows = Object.fromEntries((await db.query<{ key: string; val: unknown }>("SELECT key, value AS val FROM settings")).map((r) => [r.key, r.val]));
    expect(rows.accent).toBe("#C2410C");
    expect(rows.team_glyphs).toEqual({ Sales: "bolt" });
    expect(rows.team_colors).toEqual({ Sales: "#0337DC" });
    await migrate(db, all); // applying again changes nothing
  });
});

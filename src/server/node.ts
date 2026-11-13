/* Local and self-hosted entry point.

     node src/server/node.ts --demo     the sample backlog in PGlite, freshly reset (what `make demo` runs)
     node src/server/node.ts --hosted   both spaces behind one link (what Render runs): the demo as above, plus the
                                        real backlog in Postgres at DATABASE_URL for signed-in users, migrated on start
     node src/server/node.ts            serve against DATABASE_URL, or PGlite in .data/ if it is unset
     node src/server/node.ts --migrate  apply migrations to DATABASE_URL, then exit (use before a deploy)

   Safety: sample data is only ever loaded into PGlite, or into DATABASE_URL when
   SEED_SAMPLE=1 is set on purpose. `--demo` ignores DATABASE_URL entirely, so a
   shell that exports a production URL can never have its tables reset by a demo. `--hosted` keeps
   that rule: the sample goes into the demo's PGlite only, never into DATABASE_URL, and SEED_SAMPLE is ignored. */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { authConfigFromEnv } from "./auth.ts";
import { createHosted } from "./hosted.ts";
import { migrate, pglite, postgresJs, type Db } from "./db.ts";
import { seedSql } from "./seed.ts";
import { keepAlive, sampleIsStale, scheduleNightly } from "./nightly.ts";

const root = new URL("../..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8787);
const hosted = process.argv.includes("--hosted");
const demo = process.argv.includes("--demo") || hosted;
const migrateOnly = process.argv.includes("--migrate");
const url = demo ? undefined : process.env.DATABASE_URL;

if (migrateOnly && !url) { console.error("--migrate needs DATABASE_URL."); process.exit(1); }
// The demo gets its own folder, so `make demo` never wipes a local non-demo database.
const dataDir = join(root, ".data", demo ? "demo" : "local");
if (demo) rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
// Creating a Postgres data folder from nothing takes about 900 MB, more than the free Render plan has.
// The hosted demo opens a copy made ahead of time (npm run demo:snapshot); the sample is reloaded over it.
const snapshot = join(root, "samples", "demo-snapshot.tgz");
if (demo && process.env.PUBLIC_DEMO === "1" && existsSync(snapshot)) execFileSync("tar", ["xzf", snapshot, "-C", join(root, ".data")]);
const db: Db = url ? await postgresJs(url) : await pglite(dataDir);

const migrations = readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(join(root, "migrations", name), "utf8") }));
await migrate(db, migrations);
if (migrateOnly) { console.log("Migrations applied."); await db.close(); process.exit(0); }

const empty = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items"))[0]?.n === 0;
const mayLoadSample = !url || (process.env.SEED_SAMPLE === "1" && !hosted);
if (hosted && process.env.SEED_SAMPLE === "1") console.warn("SEED_SAMPLE is ignored with --hosted: the sample only ever goes into the demo space.");
const reload = async () => { await db.exec(seedSql()); console.log("Loaded the sample backlog."); };
let missed = false;
if (mayLoadSample && !demo && !empty) {
  const row = (await db.query<{ t: string | Date | null }>("SELECT max(created_at) AS t FROM items"))[0];
  missed = sampleIsStale(row?.t ? new Date(row.t).getTime() : null, Date.now());
}
if (demo || (empty && mayLoadSample) || missed) await reload();
// The Cloudflare cron's job, in-process: reload the sample every night at 06:00 UTC.
if (mayLoadSample) scheduleNightly(reload);
// The real database (DATABASE_URL) gets one tiny read each night too, so a free Supabase project never pauses.
// `realTarget` is set below in hosted mode (the real space) or here when the server itself runs on DATABASE_URL.
let realTarget: (() => Promise<Db>) | null = !demo && url ? async () => db : null;
const nightlyKeepAlive = async () => { await keepAlive(realTarget); };
scheduleNightly(nightlyKeepAlive);
if (realTarget) void nightlyKeepAlive(); // catch-up on start

const dist = join(root, "dist");
let closeReal: () => Promise<void> = async () => {};
let api: Hono<any>;
if (hosted) {
  const realUrl = process.env.DATABASE_URL?.trim() || undefined;
  const { config: auth, problems } = authConfigFromEnv(process.env);
  if (problems.length) console.warn(`Google sign-in is off (demo only): ${problems.join("; ")}.`);
  // The real database opens (and migrates) on start, in the background so the demo is up at once. A failure is
  // retried on the next request after 15 seconds; the demo keeps serving meanwhile.
  let real: Promise<Db> | null = null;
  const openReal = (): Promise<Db> => {
    if (real) return real;
    const p = (async () => {
      const d = await postgresJs(realUrl!);
      try { await migrate(d, migrations); } catch (e) { await d.close().catch(() => {}); throw e; }
      console.log("Real space ready (migrations applied).");
      return d;
    })();
    real = p;
    p.catch((e) => { console.error("Real space failed to open:", e); setTimeout(() => { if (real === p) real = null; }, 15_000).unref(); });
    return p;
  };
  closeReal = async () => { await real?.then((d) => d.close()).catch(() => {}); };
  if (realUrl) { realTarget = openReal; openReal().catch(() => {}); nightlyKeepAlive(); }
  const signinFile = join(dist, "signin.html");
  const signinHtml = existsSync(signinFile) ? readFileSync(signinFile, "utf8") : "<!doctype html><title>GTM Backlog</title><!--message--><form method=\"post\" action=\"/auth/demo\"><button>Try the demo</button></form>";
  api = createHosted({ demoDb: db, realDb: realUrl ? openReal : null, auth, writeKey: process.env.WRITE_KEY || undefined, signinHtml });
  console.log(`Spaces: demo${realUrl ? " + real" : ""}; Google sign-in ${auth && realUrl ? "on" : "off"}; write key ${process.env.WRITE_KEY && realUrl ? "on" : "off"}.`);
} else {
  api = createApp(() => db, { writeKey: process.env.WRITE_KEY, demo: !url || process.env.SEED_SAMPLE === "1" });
}
if (existsSync(dist)) {
  // Safari (so every iPhone) will not play an MP4 served whole with a 200: answer byte ranges, as the Worker does.
  api.get("/video/:file", (c) => {
    const file = join(dist, "video", basename(c.req.param("file")));
    if (!existsSync(file)) return c.notFound();
    const size = statSync(file).size;
    const h = { "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=86400" };
    const m = (c.req.header("range") ?? "").match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (m[1] === "" && m[2] === "")) return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...h, "content-length": String(size) } });
    const start = Math.max(0, m[1] === "" ? size - Number(m[2]) : Number(m[1]));
    const end = Math.min(size - 1, m[1] !== "" && m[2] !== "" ? Number(m[2]) : size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { ...h, "content-range": `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206, headers: { ...h, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  });
  api.use("/*", serveStatic({ root: "./dist" }));
  api.get("*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: api.fetch, port, hostname: process.env.HOST?.trim() || undefined }, () => {
  console.log(`gtm-backlog on http://localhost:${port}  (database: ${url ? "DATABASE_URL" : "PGlite in .data/"})`);
});

const stop = async () => { await closeReal(); await db.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

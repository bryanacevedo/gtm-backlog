/* Local and self-hosted entry point.

     node src/server/node.ts --demo     the sample backlog in PGlite, freshly reset (what `make demo` runs)
     node src/server/node.ts            serve against DATABASE_URL, or PGlite in .data/ if it is unset
     node src/server/node.ts --migrate  apply migrations to DATABASE_URL, then exit (use before a deploy)

   Safety: sample data is only ever loaded into PGlite, or into DATABASE_URL when
   SEED_SAMPLE=1 is set on purpose. `--demo` ignores DATABASE_URL entirely, so a
   shell that exports a production URL can never have its tables reset by a demo. */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createReadStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { createApp } from "./app.ts";
import { migrate, pglite, postgresJs, type Db } from "./db.ts";
import { seedSql } from "./seed.ts";
import { sampleIsStale, scheduleNightly } from "./nightly.ts";

const root = new URL("../..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8787);
const demo = process.argv.includes("--demo");
const migrateOnly = process.argv.includes("--migrate");
const url = demo ? undefined : process.env.DATABASE_URL;

if (migrateOnly && !url) { console.error("--migrate needs DATABASE_URL."); process.exit(1); }
if (demo) rmSync(join(root, ".data"), { recursive: true, force: true });
const db: Db = url ? await postgresJs(url) : await pglite(join(root, ".data"));

const migrations = readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(join(root, "migrations", name), "utf8") }));
await migrate(db, migrations);
if (migrateOnly) { console.log("Migrations applied."); await db.close(); process.exit(0); }

const empty = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items"))[0]?.n === 0;
const mayLoadSample = !url || process.env.SEED_SAMPLE === "1";
const reload = async () => { await db.exec(seedSql()); console.log("Loaded the sample backlog."); };
let missed = false;
if (mayLoadSample && !demo && !empty) {
  const row = (await db.query<{ t: string | Date | null }>("SELECT max(created_at) AS t FROM items"))[0];
  missed = sampleIsStale(row?.t ? new Date(row.t).getTime() : null, Date.now());
}
if (demo || (empty && mayLoadSample) || missed) await reload();
// The Cloudflare cron's job, in-process: reload the sample every night at 06:00 UTC.
if (mayLoadSample) scheduleNightly(reload);

const api = createApp(() => db, { writeKey: process.env.WRITE_KEY, demo: !url || process.env.SEED_SAMPLE === "1" });
const dist = join(root, "dist");
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

const stop = async () => { await db.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

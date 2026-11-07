/* Local and self-hosted entry point.

     node src/server/node.ts --demo     the sample backlog in PGlite, freshly reset (what `make demo` runs)
     node src/server/node.ts            serve against DATABASE_URL, or PGlite in .data/ if it is unset
     node src/server/node.ts --migrate  apply migrations to DATABASE_URL, then exit (use before a deploy)

   Safety: sample data is only ever loaded into PGlite, or into DATABASE_URL when
   SEED_SAMPLE=1 is set on purpose. `--demo` ignores DATABASE_URL entirely, so a
   shell that exports a production URL can never have its tables reset by a demo. */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { migrate, pglite, postgresJs, type Db } from "./db.ts";
import { seedSql } from "./seed.ts";

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
if (demo || (empty && mayLoadSample)) {
  await db.exec(seedSql());
  console.log("Loaded the sample backlog.");
}

const api = createApp(() => db, { writeKey: process.env.WRITE_KEY, demo: !url || process.env.SEED_SAMPLE === "1" });
const dist = join(root, "dist");
if (existsSync(dist)) {
  api.use("/*", serveStatic({ root: "./dist" }));
  api.get("*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: api.fetch, port }, () => {
  console.log(`gtm-backlog on http://localhost:${port}  (database: ${url ? "DATABASE_URL" : "PGlite in .data/"})`);
});

const stop = async () => { await db.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

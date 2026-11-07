/* Local and self-hosted entry point.
     node src/server/node.ts            serve the API (and the built app, if dist/ exists)
     node src/server/node.ts --reset    rebuild the database and load the sample data, then serve
   Database: DATABASE_URL if set (any Postgres), otherwise PGlite, a real Postgres
   running inside this process with its files in .data/, so nothing needs installing. */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { migrate, pglite, postgresJs, type Db } from "./db.ts";

const root = new URL("../..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8787);
const reset = process.argv.includes("--reset");
const url = process.env.DATABASE_URL;

if (reset && !url) rmSync(join(root, ".data"), { recursive: true, force: true });
const db: Db = url ? await postgresJs(url) : await pglite(join(root, ".data"));

const migrations = readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(join(root, "migrations", name), "utf8") }));
await migrate(db, migrations);

const empty = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items"))[0]?.n === 0;
if (reset || empty) {
  const seed = execFileSync(process.execPath, [join(root, "scripts/gen-seed.ts")], { encoding: "utf8" });
  await db.exec(seed);
  console.log("Loaded the sample backlog.");
}

const api = createApp(() => db, { writeKey: process.env.WRITE_KEY, demo: process.env.DEMO !== "0" });
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

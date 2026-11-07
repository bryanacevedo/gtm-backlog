/* Cloudflare entry point: the hosted demo.
   - /api/* runs the same Hono app as local, against Postgres at DATABASE_URL (Supabase).
   - Everything else is the built app, served from Cloudflare's asset store.
   - A nightly cron reloads the sample backlog, so visitors always see a clean demo
     (and the free Supabase project never idles long enough to pause). */

import { createApp } from "./app.ts";
import { postgresJs } from "./db.ts";
import { seedSql } from "./seed.ts";

interface Env {
  DATABASE_URL: string;
  WRITE_KEY?: string;
  DEMO?: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (!new URL(req.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    // One short-lived connection per request through Supabase's transaction pooler.
    const db = await postgresJs(env.DATABASE_URL, { max: 1 });
    const app = createApp(() => db, { writeKey: env.WRITE_KEY, demo: env.DEMO !== "0" });
    const res = await app.fetch(req);
    ctx.waitUntil(db.close());
    return res;
  },

  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    const db = await postgresJs(env.DATABASE_URL, { max: 1 });
    ctx.waitUntil(db.exec(seedSql()).finally(() => db.close()));
  },
};

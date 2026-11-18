/* Cloudflare entry point: the hosted app, two spaces behind one link (the same as `node src/server/node.ts --hosted`).

   Demo   Postgres at DEMO_DATABASE_URL. Anyone can use it; the nightly cron reloads the sample into it.
   Real   Postgres at DATABASE_URL, for allowlisted Google accounts and the WRITE_KEY header. No sample is ever loaded.

   The space is chosen from credentials in `createHosted` (hosted.ts), exactly as on Node. Every request opens
   one short-lived connection per space it uses, through Supabase's transaction pooler, and closes it after.
   Pages go through the Worker first, so a visitor who is not signed in and not in the demo gets the sign-in page;
   built files (/assets/*, images) come straight from the asset store. */

import { authConfigFromEnv } from "./auth.ts";
import { createHosted } from "./hosted.ts";
import { migrate, postgresJs, type Db } from "./db.ts";
import { seedSql } from "./seed.ts";
import { keepAlive } from "./nightly.ts";
import { MIGRATIONS } from "./migrations-bundle.ts";
import { isFile, sameDatabase } from "./worker-rules.ts";

export interface Env {
  /** The demo's database. Reset every night; never point it at the real one. */
  DEMO_DATABASE_URL: string;
  /** The real backlog. Unset means demo only. */
  DATABASE_URL?: string;
  WRITE_KEY?: string;
  ACCENT?: string;
  GITHUB_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  PUBLIC_URL?: string;
  ALLOWED_EMAILS?: string;
  ALLOWED_DOMAIN?: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

const PER_REQUEST = 5;
const FALLBACK_SIGNIN = "<!doctype html><title>GTM Backlog</title><!--message--><form method=\"post\" action=\"/auth/demo\"><button>Try the demo</button></form>";


/* Videos need byte-range responses: Safari (and so every iPhone) will not play
   an MP4 served whole with a 200. Slice the asset and answer 206. */
async function serveVideo(req: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(req.url));
  if (!asset.ok) return asset;
  const body = await asset.arrayBuffer();
  const size = body.byteLength;
  const headers = { "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=86400" };
  const m = (req.headers.get("range") ?? "").match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return new Response(body, { headers: { ...headers, "content-length": String(size) } });
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : size - 1;
  start = Math.max(0, start); end = Math.min(size - 1, end);
  if (start > end) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}

async function signinHtml(env: Env, url: URL): Promise<string> {
  // The asset store serves dist/signin.html at /signin (it drops the .html).
  for (const p of ["/signin", "/signin.html"]) {
    const res = await env.ASSETS.fetch(new Request(new URL(p, url)));
    if (res.ok) return res.text();
  }
  return FALLBACK_SIGNIN;
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path.startsWith("/video/")) return serveVideo(req, env);
    if (isFile(path)) return env.ASSETS.fetch(req);
    if (!env.DEMO_DATABASE_URL || sameDatabase(env.DEMO_DATABASE_URL, env.DATABASE_URL)) {
      console.error("DEMO_DATABASE_URL is missing or is the same as DATABASE_URL; refusing to serve.");
      return Response.json({ error: "This server is not set up." }, { status: 503 });
    }

    // Up to 5 connections per space (a Worker request may hold 6 sockets): /api/state reads six things at once,
    // and queued on one connection through the pooler they stalled for 20 s (measured 2026-11-18).
    const demoDb = await postgresJs(env.DEMO_DATABASE_URL, { max: PER_REQUEST });
    let real: Promise<Db> | null = null;
    const realUrl = env.DATABASE_URL?.trim() || undefined;
    const realDb = realUrl ? () => (real ??= postgresJs(realUrl, { max: PER_REQUEST })) : null;
    const { config: auth } = authConfigFromEnv(env as unknown as Record<string, string | undefined>);
    const api = path.startsWith("/api/");
    const app = createHosted({
      demoDb, realDb, auth,
      writeKey: env.WRITE_KEY || undefined, accent: env.ACCENT || undefined, githubToken: env.GITHUB_TOKEN || undefined,
      anthropicKey: env.ANTHROPIC_API_KEY || undefined,
      signinHtml: api ? FALLBACK_SIGNIN : await signinHtml(env, url),
    });
    try {
      const res = await app.fetch(req);
      // A page the API does not answer is the app itself (the asset store falls back to index.html).
      if (res.status === 404 && !api && !path.startsWith("/auth/")) return env.ASSETS.fetch(req);
      return res;
    } finally {
      ctx.waitUntil(Promise.all([demoDb.close(), (real as Promise<Db> | null)?.then((d) => d.close(), () => {})]));
    }
  },

  /* 06:00 UTC: migrate both spaces, reload the sample into the demo, and touch the real database
     so a free Supabase project never pauses. The migration lock holds one connection while the migration runs on
     another, so the pool needs at least 2. */
  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    ctx.waitUntil((async () => {
      if (!env.DEMO_DATABASE_URL || sameDatabase(env.DEMO_DATABASE_URL, env.DATABASE_URL)) {
        console.error("Nightly skipped: DEMO_DATABASE_URL is missing or is the same as DATABASE_URL.");
        return;
      }
      const demo = await postgresJs(env.DEMO_DATABASE_URL, { max: PER_REQUEST });
      try { await migrate(demo, MIGRATIONS); await demo.exec(seedSql()); console.log("Loaded the sample backlog."); }
      finally { await demo.close(); }
      if (env.DATABASE_URL) {
        const real = await postgresJs(env.DATABASE_URL, { max: PER_REQUEST });
        try { await migrate(real, MIGRATIONS); await keepAlive(async () => real); }
        finally { await real.close(); }
      }
    })());
  },
};

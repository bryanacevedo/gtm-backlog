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
  ACCENT?: string;
  GITHUB_TOKEN?: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

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

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/video/")) return serveVideo(req, env);
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
    // One short-lived connection per request through Supabase's transaction pooler.
    const db = await postgresJs(env.DATABASE_URL, { max: 1 });
    const app = createApp(() => db, { writeKey: env.WRITE_KEY, demo: env.DEMO !== "0", accent: env.ACCENT, githubToken: env.GITHUB_TOKEN });
    const res = await app.fetch(req);
    ctx.waitUntil(db.close());
    return res;
  },

  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    const db = await postgresJs(env.DATABASE_URL, { max: 1 });
    ctx.waitUntil(db.exec(seedSql()).finally(() => db.close()));
  },
};

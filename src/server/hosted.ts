/* The hosted app: two data spaces behind one link.

   Demo   the sample backlog (PGlite). Anyone can use it. Writes stay in it.
   Real   Postgres at DATABASE_URL. Reached only with a valid sign-in (an allowlisted Google account)
          or the WRITE_KEY header, never by anything the request merely names. No sample is ever loaded.

   The space is decided from credentials in one place (`resolve` below). An anonymous request, or one
   with a forged cookie, a bad signature or an address off the list, always gets the demo database;
   there is no path from the demo to the real one. */

import { Hono, type Context } from "hono";
import { createApp, type Space } from "./app.ts";
import { crossSite, mountAuth, renderSignin, safeEqual, sessionFrom, viewingDemo, type AuthConfig } from "./auth.ts";
import type { Db } from "./db.ts";

export interface HostedDeps {
  demoDb: Db;
  /** Opens the real database (migrated). Null when DATABASE_URL is not set. Called per request, so it should cache. */
  realDb: (() => Promise<Db>) | null;
  auth: AuthConfig | null;
  writeKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** dist/signin.html, with a `<!--message-->` slot. */
  signinHtml: string;
}

const refuse = (message: string, status: 401 | 403 | 503) => Response.json({ error: message }, { status });
const isPage = (path: string) => !path.startsWith("/api/") && !path.startsWith("/auth/") && !path.startsWith("/assets/") && !path.startsWith("/video/") && !/\.[a-z0-9]{2,5}$/i.test(path);

export function createHosted(d: HostedDeps) {
  const now = d.now ?? Date.now;
  const auth = d.auth && d.realDb ? d.auth : null; // signing in is offered only when there is a real space to enter
  const app = new Hono();

  const page = (message?: string) => renderSignin(d.signinHtml, message);
  mountAuth(app, { cfg: auth, fetch: d.fetch ?? fetch, now, signinPage: page });

  // Visitors who are neither signed in nor in the demo see the sign-in page, wherever they land.
  app.use("*", async (c, next) => {
    if (!auth || (c.req.method !== "GET" && c.req.method !== "HEAD") || !isPage(new URL(c.req.url).pathname)) return next();
    if (sessionFrom(c, auth, Math.floor(now() / 1000)) || viewingDemo(c, auth)) return next();
    return c.html(page(), 200, { "cache-control": "no-store" });
  });

  const resolve = async (c: Context): Promise<Space | Response> => {
    const real = async (): Promise<Db | Response> => {
      if (!d.realDb) return refuse("The real backlog is not set up on this server.", 503);
      try { return await d.realDb(); } catch (e) { console.error("Real database unavailable:", e); return refuse("The backlog database is not reachable right now. Try again in a minute.", 503); }
    };
    const meta = { signIn: Boolean(auth) };

    // A script with the team write key reaches the real space. A wrong key is refused, never sent to the demo.
    const key = c.req.header("x-write-key");
    if (d.writeKey && key) {
      if (!d.realDb) return refuse("The real backlog is not set up on this server.", 503);
      if (!safeEqual(key, d.writeKey)) return refuse("That write key is not right.", 401);
      const db = await real();
      return db instanceof Response ? db : { db, demo: false, actorPrefix: "script: ", meta: { ...meta, space: "real", user: null } };
    }

    const user = sessionFrom(c, auth, Math.floor(now() / 1000));
    if (user && !viewingDemo(c, auth)) {
      if (c.req.method !== "GET" && crossSite(c, auth)) return refuse("That request came from another site, so it was not made.", 403);
      const db = await real();
      return db instanceof Response ? db : { db, demo: false, actor: user.name, meta: { ...meta, space: "real", user: { name: user.name, email: user.email } } };
    }
    return { db: d.demoDb, demo: true, meta: { ...meta, space: "demo", user: user ? { name: user.name, email: user.email } : null } };
  };

  app.route("/", createApp(() => d.demoDb, { writeKey: d.writeKey, demo: true, resolve }));
  return app;
}

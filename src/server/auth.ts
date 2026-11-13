/* Sign-in with Google (OpenID Connect, authorization code flow with PKCE, state and nonce),
   the session cookie, and the allowlist. Node only: the Cloudflare Worker never imports this.

   Nothing here trusts the browser:
   - The flow's state, nonce and PKCE verifier travel in one short-lived signed cookie, and the
     callback must present the same state.
   - The ID token is checked by jose: RS256 signature against Google's published keys, issuer,
     audience, expiry, and required claims. Then the nonce, a verified email, and the allowlist.
   - The session is an HMAC-signed cookie (SESSION_SECRET), httpOnly, SameSite=Lax, Secure on https.
     The allowlist is checked again on every request, so removing an address revokes it at once.
   Google is reached only through the injected `fetch`, so tests never call it. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet } from "jose";
import type { Context, Hono } from "hono";
import { safeEqual } from "./safe.ts";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const SESSION_SECONDS = 7 * 86_400;
const FLOW_SECONDS = 600;
const SPACE_SECONDS = 30 * 86_400;

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  /** PUBLIC_URL without a trailing slash. */
  publicUrl: string;
  origin: string;
  redirectUri: string;
  emails: Set<string>;
  domain: string | null;
  secure: boolean;
}

export interface Session { sub: string; email: string; name: string; hd?: string; picture?: string; exp: number }

/** The profile photo from Google's ID token, kept only if it is a plain https URL of a sane length. Anything else is dropped,
    so the browser is never handed a script, data or http address to load. */
export function cleanPicture(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length === 0 || v.length > 400 || /[\s\x00-\x1f\x7f]/.test(v)) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.href : undefined;
  } catch { return undefined; }
}

/** Reads the sign-in settings. `config` is null (demo-only) unless every required one is present and valid;
    `problems` explains a half-finished setup so the log says what is missing. */
export function authConfigFromEnv(env: Record<string, string | undefined>): { config: AuthConfig | null; problems: string[] } {
  const v = (k: string) => (env[k] ?? "").trim();
  const keys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "PUBLIC_URL"];
  const anySet = keys.some((k) => v(k)) || v("ALLOWED_EMAILS") || v("ALLOWED_DOMAIN");
  const problems: string[] = [];
  for (const k of keys) if (!v(k)) problems.push(`${k} is not set`);
  const emails = new Set(v("ALLOWED_EMAILS").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  const domain = v("ALLOWED_DOMAIN").toLowerCase().replace(/^@/, "") || null;
  if (domain && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)) problems.push("ALLOWED_DOMAIN must be one domain, like example.com");
  if (!emails.size && !domain) problems.push("ALLOWED_EMAILS or ALLOWED_DOMAIN is not set");
  if (v("SESSION_SECRET") && v("SESSION_SECRET").length < 32) problems.push("SESSION_SECRET must be at least 32 characters");
  let origin = "";
  if (v("PUBLIC_URL")) {
    try {
      const u = new URL(v("PUBLIC_URL"));
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      origin = u.origin;
      if (u.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/.test(u.hostname)) problems.push("PUBLIC_URL must be https (http is only for localhost)");
    } catch { problems.push("PUBLIC_URL is not a valid http(s) URL"); }
  }
  if (problems.length) return { config: null, problems: anySet ? problems : [] };
  const publicUrl = v("PUBLIC_URL").replace(/\/+$/, "");
  return {
    problems: [],
    config: {
      clientId: v("GOOGLE_CLIENT_ID"), clientSecret: v("GOOGLE_CLIENT_SECRET"), sessionSecret: v("SESSION_SECRET"),
      publicUrl, origin, redirectUri: `${publicUrl}/auth/google/callback`, emails, domain, secure: origin.startsWith("https:"),
    },
  };
}

/** The allowlist: the address itself, or any address at ALLOWED_DOMAIN. Case-insensitive. A domain match also needs Google's
    `hd` claim to name that domain (a Workspace account), because a verified email alone only proves the address once worked. */
export function isAllowed(cfg: AuthConfig, email: string, hd?: string): boolean {
  if (!/^[\x21-\x7e]+$/.test(email.trim())) return false; // ASCII only: no case-folding surprises
  const e = email.trim().toLowerCase();
  if (e.split("@").length !== 2) return false;
  if (cfg.emails.has(e)) return true;
  return cfg.domain != null && e.endsWith(`@${cfg.domain}`) && e.length > cfg.domain.length + 1 && (hd ?? "").toLowerCase() === cfg.domain;
}

/* ------------------------------------------------------- signed cookies */

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, kind: string, body: string) => createHmac("sha256", secret).update(`${kind}.${body}`).digest();

/** body.signature, where the signature covers the kind too, so a flow cookie can never pass as a session. */
export function sign(secret: string, kind: string, payload: object): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(secret, kind, body))}`;
}

export function unsign<T extends { exp: number }>(secret: string, kind: string, token: string | undefined, nowSec: number): T | null {
  if (!token || token.length > 4096) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(secret, kind, body);
  let got: Buffer;
  try { got = Buffer.from(sig, "base64url"); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return typeof p.exp === "number" && p.exp > nowSec ? p : null;
  } catch { return null; }
}

export { safeEqual };

export const cookieNames = (cfg: Pick<AuthConfig, "secure"> | null) => {
  const p = cfg?.secure ? "__Host-" : "";
  return { session: `${p}bl_session`, flow: `${p}bl_flow`, space: `${p}bl_space` };
};

const cookieOpts = (cfg: AuthConfig | null, maxAge: number) =>
  ({ httpOnly: true, secure: cfg?.secure ?? false, sameSite: "Lax" as const, path: "/", maxAge });

/** The signed-in user, if the cookie is genuine, unexpired and the address is still on the allowlist. */
export function sessionFrom(c: Context, cfg: AuthConfig | null, nowSec: number): Session | null {
  if (!cfg) return null;
  const s = unsign<Session>(cfg.sessionSecret, "session", getCookie(c, cookieNames(cfg).session), nowSec);
  return s && typeof s.email === "string" && isAllowed(cfg, s.email, s.hd) ? s : null;
}

/** True when the visitor chose "Try the demo" (or a signed-in user chose to view it). */
export const viewingDemo = (c: Context, cfg: AuthConfig | null) => getCookie(c, cookieNames(cfg).space) === "demo";

/* -------------------------------------------------------- Google (OIDC) */

export class SignInError extends Error {
  status: 400 | 403 | 502;
  constructor(message: string, status: 400 | 403 | 502 = 502) { super(message); this.status = status; }
}

export interface GoogleDeps { fetch: typeof fetch; now: () => number }

/** Google's signing keys, cached for as long as Google says (5 minutes to 1 day). */
export function jwksCache(deps: GoogleDeps) {
  let keys: JSONWebKeySet | null = null, expires = 0, fetchedAt = 0;
  return async (force = false): Promise<JSONWebKeySet> => {
    const now = deps.now();
    if (keys && now < expires && !(force && now - fetchedAt > 60_000)) return keys;
    const res = await deps.fetch(CERTS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new SignInError("Could not reach Google to check the sign-in. Try again in a minute.");
    const j = (await res.json()) as JSONWebKeySet;
    if (!Array.isArray(j.keys)) throw new SignInError("Google's signing keys came back unreadable. Try again in a minute.");
    const age = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
    keys = j; fetchedAt = now; expires = now + Math.min(Math.max(age, 300), 86_400) * 1000;
    return keys;
  };
}

export interface Identity { sub: string; email: string; name: string; hd?: string; picture?: string }

/** Checks an ID token end to end and returns who it says the user is. Throws SignInError with a plain message. */
export async function verifyIdToken(idToken: string, cfg: AuthConfig, nonce: string, deps: GoogleDeps, jwks: ReturnType<typeof jwksCache>): Promise<Identity> {
  const check = async (force: boolean) =>
    jwtVerify(idToken, createLocalJWKSet(await jwks(force)), {
      algorithms: ["RS256"], issuer: ISSUERS, audience: cfg.clientId,
      requiredClaims: ["exp", "iat", "sub", "email"], clockTolerance: 30, currentDate: new Date(deps.now()),
    });
  let payload;
  try {
    try { ({ payload } = await check(false)); }
    catch (e) { if (e instanceof joseErrors.JWKSNoMatchingKey) ({ payload } = await check(true)); else throw e; }
  } catch (e) {
    if (e instanceof SignInError) throw e;
    if (e instanceof joseErrors.JWTExpired) throw new SignInError("That sign-in expired. Start again.");
    throw new SignInError("Google's sign-in could not be verified. Start again.");
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== cfg.clientId) throw new SignInError("Google's sign-in could not be verified. Start again.");
  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, nonce)) throw new SignInError("That sign-in did not start here. Start again.", 400);
  if (payload.email_verified !== true) throw new SignInError("Google has not verified that email address.", 403);
  const email = String(payload.email).trim().toLowerCase();
  return { sub: String(payload.sub), email, hd: typeof payload.hd === "string" ? payload.hd : undefined, picture: cleanPicture(payload.picture), name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 60) : email.split("@")[0] };
}

async function exchangeCode(code: string, verifier: string, cfg: AuthConfig, deps: GoogleDeps): Promise<string> {
  const res = await deps.fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: verifier }),
  });
  const j = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!res.ok || typeof j.id_token !== "string") throw new SignInError("Google did not accept that sign-in. Start again.");
  return j.id_token;
}

/* ---------------------------------------------------------------- routes */

export interface AuthDeps extends GoogleDeps {
  cfg: AuthConfig | null;
  /** The sign-in page HTML, with an optional message to show above the buttons. */
  signinPage: (message?: string) => string;
}

// c.redirect, not a fresh Response, so the cookies set on the context ride along.
const redirect = (c: Context, to: string) => { const r = c.redirect(to, 303); r.headers.set("cache-control", "no-store"); return r; };

/** Same-origin check for the state-changing /auth posts and the API: a browser that sends an Origin must send ours. */
export function crossSite(c: Context, cfg: AuthConfig | null): boolean {
  const o = c.req.header("origin");
  if (cfg && o && o !== cfg.origin && o !== "null") return true;
  if (cfg && o === "null") return true;
  return c.req.header("sec-fetch-site") === "cross-site";
}

export function mountAuth(app: Hono<any>, d: AuthDeps) {
  const { cfg } = d;
  const names = cookieNames(cfg);
  const nowSec = () => Math.floor(d.now() / 1000);
  const noStore = (r: Response) => { r.headers.set("cache-control", "no-store"); return r; };

  app.post("/auth/demo", (c) => {
    if (crossSite(c, cfg)) return c.text("Not allowed.", 403);
    setCookie(c, names.space, "demo", cookieOpts(cfg, SPACE_SECONDS));
    return redirect(c, "/");
  });

  // Anonymous visitors: "Sign in" returns them to the sign-in page. Signed-in users: switch between their backlog and the demo.
  app.post("/auth/space", async (c) => {
    if (crossSite(c, cfg)) return c.text("Not allowed.", 403);
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    if (form.space === "demo") setCookie(c, names.space, "demo", cookieOpts(cfg, SPACE_SECONDS));
    else deleteCookie(c, names.space, { path: "/", secure: cfg?.secure ?? false });
    return redirect(c, "/");
  });

  app.post("/auth/signout", (c) => {
    if (crossSite(c, cfg)) return c.text("Not allowed.", 403);
    deleteCookie(c, names.session, { path: "/", secure: cfg?.secure ?? false });
    deleteCookie(c, names.space, { path: "/", secure: cfg?.secure ?? false });
    return redirect(c, "/");
  });

  if (!cfg) return;
  const jwks = jwksCache(d);

  app.get("/auth/google", (c) => {
    const state = b64(randomBytes(32)), nonce = b64(randomBytes(32)), verifier = b64(randomBytes(48));
    setCookie(c, names.flow, sign(cfg.sessionSecret, "flow", { state, nonce, verifier, exp: nowSec() + FLOW_SECONDS }), cookieOpts(cfg, FLOW_SECONDS));
    const q = new URLSearchParams({
      client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", scope: "openid email profile",
      state, nonce, code_challenge: b64(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", prompt: "select_account",
    });
    return noStore(c.redirect(`${AUTH_URL}?${q}`, 302));
  });

  app.get("/auth/google/callback", async (c) => {
    const flow = unsign<{ state: string; nonce: string; verifier: string; exp: number }>(cfg.sessionSecret, "flow", getCookie(c, names.flow), nowSec());
    const fail = (message: string, status: 400 | 403 | 502 = 400) => c.html(d.signinPage(message), status, { "cache-control": "no-store" });
    const state = c.req.query("state") ?? "", code = c.req.query("code") ?? "";
    // The flow cookie is spent only by a callback that carries its state, so a stray link cannot cancel a sign-in in progress.
    if (!flow || !state || !safeEqual(state, flow.state)) return fail("That sign-in did not start here, or it took too long. Start again.");
    deleteCookie(c, names.flow, { path: "/", secure: cfg.secure });
    if (c.req.query("error") || !code) return fail("Google sign-in was cancelled. You can try again, or try the demo.");
    let who: Identity;
    try {
      who = await verifyIdToken(await exchangeCode(code, flow.verifier, cfg, d), cfg, flow.nonce, d, jwks);
    } catch (e) {
      if (!(e instanceof SignInError)) console.error("Sign-in failed:", e);
      return fail(e instanceof SignInError ? e.message : "Could not finish signing in with Google. Try again in a minute.", e instanceof SignInError ? e.status : 502);
    }
    if (!isAllowed(cfg, who.email, who.hd)) return fail(`${who.email} does not have access to this backlog. Sign in with another Google account, or try the demo.`, 403);
    setCookie(c, names.session, sign(cfg.sessionSecret, "session", { sub: who.sub, email: who.email, name: who.name, hd: who.hd, picture: who.picture, exp: nowSec() + SESSION_SECONDS }), cookieOpts(cfg, SESSION_SECONDS));
    deleteCookie(c, names.space, { path: "/", secure: cfg.secure });
    return redirect(c, "/");
  });
}

/** Fills the built sign-in page (dist/signin.html). The message is escaped; the queue picture and the accent are trusted markup made by this server.
    A template without a slot (a test's, or the plain fallback page) just goes without. */
export function renderSignin(template: string, message?: string, extra: { queue?: string; accent?: string } = {}): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  return template
    .replace("<!--accent-->", () => extra.accent ?? "")
    .replace("<!--queue-->", () => extra.queue ?? "")
    .replace("<!--message-->", () => message ? `<p class="signin-msg" role="alert">${esc(message)}</p>` : "");
}

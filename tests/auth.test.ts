/* Sign-in and the two data spaces. Google is never called: a fake `fetch` plays its token endpoint and its
   signing keys, with a key pair made here. Two in-memory Postgres databases stand in for the demo and the real space. */
import { createHash } from "node:crypto";
import { allMigrations } from "./migrations";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authConfigFromEnv, cleanPicture, isAllowed, sign, SESSION_SECONDS, type AuthConfig } from "../src/server/auth";
import { migrate, pglite, type Db } from "../src/server/db";
import { createHosted } from "../src/server/hosted";

const ORIGIN = "https://gtm.test";
const SECRET = "s".repeat(40);
const CLIENT = "client-123.apps.googleusercontent.com";
const ENV = { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "gsecret", SESSION_SECRET: SECRET, PUBLIC_URL: ORIGIN, ALLOWED_EMAILS: "Bryan@Example.com, other@example.com", ALLOWED_DOMAIN: "team.test" };
const cfg = authConfigFromEnv(ENV).config as AuthConfig;
const SIGNIN = "<html><body><main>SIGNIN<!--message--></main></body></html>";

let demoDb: Db, realDb: Db;
let good: CryptoKeyPair, other: CryptoKeyPair, jwk: JWK;
/** What the fake Google token endpoint answers next. */
let reply: { claims?: Record<string, unknown>; key?: CryptoKey; alg?: string; kid?: string; status?: number; raw?: string } = {};
const googleCalls: string[] = [];

const googleFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  googleCalls.push(url);
  if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] }, { headers: { "cache-control": "public, max-age=3600" } });
  if (url === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_secret")).toBe("gsecret");
    expect(form.get("redirect_uri")).toBe(`${ORIGIN}/auth/google/callback`);
    pkceVerifier = form.get("code_verifier") ?? "";
    if (reply.status && reply.status !== 200) return Response.json({ error: "invalid_grant" }, { status: reply.status });
    if (reply.raw) return Response.json({ id_token: reply.raw });
    const nowSec = Math.floor(Date.now() / 1000);
    const claims = { iss: "https://accounts.google.com", aud: CLIENT, sub: "g-1", email: "bryan@example.com", email_verified: true, name: "Bryan A", nonce: lastNonce, iat: nowSec, exp: nowSec + 3600, ...reply.claims };
    const jwt = await new SignJWT(claims).setProtectedHeader({ alg: reply.alg ?? "RS256", kid: reply.kid ?? "k1" }).sign(reply.key ?? good.privateKey);
    return Response.json({ id_token: jwt });
  }
  throw new Error(`unexpected call to ${url}`);
};
let lastNonce = "", pkceVerifier = "";

let app: ReturnType<typeof createHosted>;
beforeAll(async () => {
  good = (await generateKeyPair("RS256", { extractable: true })) as CryptoKeyPair;
  other = (await generateKeyPair("RS256", { extractable: true })) as CryptoKeyPair;
  jwk = { ...(await exportJWK(good.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  demoDb = await pglite(); realDb = await pglite();
  for (const d of [demoDb, realDb]) await migrate(d, allMigrations());
  await realDb.query("INSERT INTO items (id, title, problem, team, requester) VALUES ('real1', 'REAL-SECRET', 'p', 'Sales', 'r')");
  await demoDb.query("INSERT INTO items (id, title, problem, team, requester) VALUES ('demo1', 'DEMO-SAMPLE', 'p', 'Sales', 'r')");
  app = createHosted({ demoDb, realDb: async () => realDb, auth: cfg, writeKey: "team-key", fetch: googleFetch, signinHtml: SIGNIN });
});
afterAll(async () => { await demoDb.close(); await realDb.close(); });

/* ------------------------------------------------------------- helpers */

const jar = (res: Response) => Object.fromEntries(res.headers.getSetCookie().map((c) => { const [kv] = c.split(";"); const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
const cookieHeader = (c: Record<string, string>) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; ");
const SESSION = "__Host-bl_session", SPACE = "__Host-bl_space", FLOW = "__Host-bl_flow";
const get = (path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  app.request(`${ORIGIN}${path}`, { headers: { cookie: cookieHeader(cookies), ...headers } });
const send = (method: string, path: string, body: unknown, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  app.request(`${ORIGIN}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", origin: ORIGIN, cookie: cookieHeader(cookies), ...headers } });
const titles = async (res: Response) => ((await res.json()) as { items: { title: string }[] }).items.map((i) => i.title);
const newItem = (title: string) => ({ title, problem: "p", requester: "Someone", team: "Sales" });
const count = async (db: Db, title: string) => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE title = $1", [title]))[0].n;

/** Runs the whole sign-in against the fake Google. Returns the callback response and the cookies it set. */
async function signIn(next: typeof reply = {}, opts: { state?: (s: string) => string; dropFlow?: boolean } = {}) {
  reply = next;
  const start = await get("/auth/google");
  const url = new URL(start.headers.get("location")!);
  lastNonce = url.searchParams.get("nonce")!;
  const flow = jar(start);
  const res = await get(`/auth/google/callback?code=abc&state=${opts.state ? opts.state(url.searchParams.get("state")!) : url.searchParams.get("state")}`, opts.dropFlow ? {} : flow);
  return { res, cookies: jar(res), start, url, flow };
}
const session = (email = "bryan@example.com", name = "Bryan A", expOffset = SESSION_SECONDS, secret = SECRET) =>
  ({ [SESSION]: sign(secret, "session", { sub: "g-1", email, name, hd: email.split("@")[1], exp: Math.floor(Date.now() / 1000) + expOffset }) });

/* ------------------------------------------------------ the sign-in flow */

describe("the authorization request", () => {
  it("is code flow with PKCE (S256), state, nonce and the exact redirect URI", async () => {
    const { start, url, flow } = await signIn();
    expect(start.status).toBe(302);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("redirect_uri")).toBe("https://gtm.test/auth/google/callback");
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("state")!.length).toBeGreaterThanOrEqual(40);
    expect(q.get("nonce")!.length).toBeGreaterThanOrEqual(40);
    // The challenge is the SHA-256 of the verifier that the token request later presents.
    expect(q.get("code_challenge")).toBe(createHash("sha256").update(pkceVerifier).digest("base64url"));
    expect(flow[FLOW]).toBeTruthy();
  });

  it("sets the flow cookie httpOnly, Secure, SameSite=Lax and short-lived", async () => {
    const raw = (await get("/auth/google")).headers.getSetCookie().find((c) => c.startsWith(FLOW))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/Max-Age=600/);
  });
});

describe("the allowlist", () => {
  it("lets an address on ALLOWED_EMAILS in (any letter case) and starts a session", async () => {
    const { res, cookies } = await signIn({ claims: { email: "BRYAN@example.com" } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(cookies[SESSION]).toBeTruthy();
    // ...and the session reaches the real space.
    expect((await ((await get("/api/state", cookies)).json()) as { meta: { space: string } }).meta.space).toBe("real");
  });

  it("lets anyone at ALLOWED_DOMAIN in, but not a look-alike domain", async () => {
    expect((await signIn({ claims: { email: "ana@team.test", hd: "team.test" } })).res.status).toBe(303);
    // Same address, but Google says it is not a Workspace account of that domain.
    expect((await signIn({ claims: { email: "ana@team.test" } })).res.status).toBe(403);
    expect((await signIn({ claims: { email: "ana@team.test", hd: "evil.test" } })).res.status).toBe(403);
    for (const email of ["ana@evilteam.test", "ana@team.test.evil.com", "ana@sub.team.test", "x@team.test@evil.com"])
      expect((await signIn({ claims: { email } })).res.status).toBe(403);
  });

  it("refuses everyone else with a plain message and no session", async () => {
    const { res, cookies } = await signIn({ claims: { email: "stranger@gmail.com" } });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("stranger@gmail.com does not have access to this backlog.");
    expect(html).toContain("SIGNIN");
    expect(cookies[SESSION]).toBeUndefined();
  });

  it("refuses an address Google has not verified", async () => {
    const { res, cookies } = await signIn({ claims: { email_verified: false } });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("not verified");
    expect(cookies[SESSION]).toBeUndefined();
  });

  it("escapes the address in the message", async () => {
    const { res } = await signIn({ claims: { email: "<script>x</script>@gmail.com" } });
    expect(await res.text()).not.toContain("<script>");
  });

  it("revokes a live session the moment the address leaves the list", async () => {
    expect((await get("/api/state", session("gone@example.com"))).status).toBe(200);
    expect((await ((await get("/api/state", session("gone@example.com"))).json()) as { meta: { space: string } }).meta.space).toBe("demo");
  });

  it("keeps a stray cross-site link from cancelling a sign-in in progress", async () => {
    const start = await get("/auth/google");
    const flow = jar(start);
    expect((await get("/auth/google/callback?error=x", flow)).status).toBe(400); // no state: refused, flow cookie not spent
    const stray = await get("/auth/google/callback?error=x", flow);
    expect(stray.headers.getSetCookie().some((c) => c.startsWith(FLOW))).toBe(false);
  });

  it("refuses non-ASCII look-alikes and does not break the page on odd characters", async () => {
    expect(isAllowed(cfg, "bryan@example.com")).toBe(true);
    expect(isAllowed(cfg, "Bryan@example.com")).toBe(true);
    expect(isAllowed(cfg, "\u212Aim@example.com")).toBe(false);
    const { res } = await signIn({ claims: { email: "a$`b@gmail.com" } });
    expect(await res.text()).toContain("a$`b@gmail.com does not have");
  });

  it("matches addresses and domains the documented way", () => {
    expect(isAllowed(cfg, "OTHER@example.com")).toBe(true);
    expect(isAllowed(cfg, "a@team.test", "team.test")).toBe(true);
    expect(isAllowed(cfg, "a@team.test")).toBe(false);
    expect(isAllowed(cfg, "@team.test")).toBe(false);
    expect(isAllowed(cfg, "")).toBe(false);
  });
});

describe("the profile photo", () => {
  type State = { meta: { user: { name: string; picture?: string } } };
  const stateFor = async (cookies: Record<string, string>) => ((await (await get("/api/state", cookies)).json()) as State).meta.user;

  it("keeps an https picture from Google's token and shows it in meta.user", async () => {
    const picture = "https://lh3.googleusercontent.com/a/ACg8oc=s96-c";
    const { res, cookies } = await signIn({ claims: { picture } });
    expect(res.status).toBe(303);
    expect(await stateFor(cookies)).toMatchObject({ name: "Bryan A", picture });
  });

  it("signs in without a photo when the token has none", async () => {
    const { res, cookies } = await signIn({});
    expect(res.status).toBe(303);
    expect((await stateFor(cookies)).picture).toBeUndefined();
  });

  it("drops a picture that is not https, still signs the user in, and never passes it on", async () => {
    for (const picture of ["http://lh3.googleusercontent.com/a/x", "javascript:alert(1)", "data:image/png;base64,AAAA", "//lh3.googleusercontent.com/a/x", "https://user:pw@lh3.googleusercontent.com/a/x", `https://lh3.googleusercontent.com/${"a".repeat(500)}`]) {
      const { res, cookies } = await signIn({ claims: { picture } });
      expect(res.status, picture.slice(0, 40)).toBe(303);
      expect((await stateFor(cookies)).picture, picture.slice(0, 40)).toBeUndefined();
    }
  });

  it("validates a stored session's picture again before handing it to the page", async () => {
    const bad = { [SESSION]: sign(SECRET, "session", { sub: "g-1", email: "bryan@example.com", name: "Bryan A", picture: "http://evil.test/x.png", exp: Math.floor(Date.now() / 1000) + 600 }) };
    expect((await stateFor(bad)).picture).toBeUndefined();
  });

  it("cleanPicture accepts https and rejects everything else", () => {
    expect(cleanPicture("https://lh3.googleusercontent.com/a/x=s96-c")).toBe("https://lh3.googleusercontent.com/a/x=s96-c");
    for (const v of ["http://a.test/x", "ftp://a.test/x", "https://", "not a url", "https://a.test/a b", "", 42, null, undefined]) expect(cleanPicture(v), String(v)).toBeUndefined();
  });
});

describe("the ID token is checked", () => {
  const refused = (next: typeof reply, say: RegExp) => refusedAs(502, next, say);
  const refusedAs = async (status: number, next: typeof reply, say: RegExp) => {
    const { res, cookies } = await signIn(next);
    expect(res.status).toBe(status);
    expect(await res.text()).toMatch(say);
    expect(cookies[SESSION]).toBeUndefined();
  };
  it("refuses a bad signature (signed by some other key)", () => refused({ key: other.privateKey }, /could not be verified/));
  it("refuses a key id Google does not publish", () => refused({ kid: "nope" }, /could not be verified/));
  it("refuses the wrong audience", () => refused({ claims: { aud: "someone-elses-client" } }, /could not be verified/));
  it("refuses the wrong issuer", () => refused({ claims: { iss: "https://evil.example" } }, /could not be verified/));
  it("refuses an expired token", () => refused({ claims: { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 } }, /expired/));
  it("refuses a token with no expiry", () => refused({ claims: { exp: undefined } }, /could not be verified/));
  it("refuses a token minted for another sign-in (wrong nonce)", () => refusedAs(400, { claims: { nonce: "replayed" } }, /did not start here/));
  it("refuses an unsigned token (alg none)", () => refused({ raw: `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, sub: "x", email: "bryan@example.com", email_verified: true, exp: 9999999999, iat: 1 })).toString("base64url")}.`, claims: {} }, /could not be verified/));
  it("refuses a token signed with HMAC using the public key as the secret", () => refused({ alg: "HS256", key: new TextEncoder().encode(JSON.stringify(jwk)) as unknown as CryptoKey }, /could not be verified/));
  it("refuses a code Google rejects", () => refused({ status: 400 }, /did not accept/));

  it("refuses a callback with the wrong state, no flow cookie, or a cancelled sign-in", async () => {
    for (const r of [await signIn({}, { state: (s) => s + "x" }), await signIn({}, { dropFlow: true })]) {
      expect(r.res.status).toBe(400);
      expect(r.cookies[SESSION]).toBeUndefined();
    }
    const start = await get("/auth/google");
    const cancelled = await get(`/auth/google/callback?error=access_denied&state=${new URL(start.headers.get("location")!).searchParams.get("state")}`, jar(start));
    expect(cancelled.status).toBe(400);
    expect(await cancelled.text()).toContain("cancelled");
  });

  it("will not accept the same callback twice (the flow cookie is spent)", async () => {
    const first = await signIn();
    expect(first.res.status).toBe(303);
    // A replay with the cookie the first callback cleared.
    const replay = await get(`/auth/google/callback?code=abc&state=${first.url.searchParams.get("state")}`, {});
    expect(replay.status).toBe(400);
  });
});

/* --------------------------------------------------- cookie and sign-out */

describe("the session cookie", () => {
  it("is httpOnly, Secure, SameSite=Lax, host-only, and lasts seven days", async () => {
    const { res } = await signIn();
    const raw = res.headers.getSetCookie().find((c) => c.startsWith(SESSION))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/;\s*Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).not.toMatch(/Domain=/i);
    expect(raw).toContain(`Max-Age=${7 * 86_400}`);
    expect(raw).not.toContain("bryan@example.com"); // signed, not secret, but it is not the address in the clear either way
  });

  it("is not the session once its payload is touched, signed with another secret, or expired", async () => {
    const real = session()[SESSION];
    const [body, sig] = real.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "x", email: "bryan@example.com", name: "Mallory", exp: 9999999999 })).toString("base64url");
    for (const bad of [`${forged}.${sig}`, session("bryan@example.com", "B", SESSION_SECONDS, "x".repeat(40))[SESSION], session("bryan@example.com", "B", -10)[SESSION], `${body}.`, body, "", "a.b.c"]) {
      const meta = ((await (await get("/api/state", { [SESSION]: bad })).json()) as { meta: { space: string } }).meta;
      expect(meta.space).toBe("demo");
    }
  });

  it("is not accepted as a sign-in flow cookie, nor the reverse", async () => {
    const flowAsSession = sign(SECRET, "flow", { state: "s", nonce: "n", verifier: "v", exp: Math.floor(Date.now() / 1000) + 600, email: "bryan@example.com", name: "x" });
    expect(((await (await get("/api/state", { [SESSION]: flowAsSession })).json()) as { meta: { space: string } }).meta.space).toBe("demo");
  });
});

describe("sign-out and switching", () => {
  it("clears the session and the space choice", async () => {
    const res = await send("POST", "/auth/signout", {}, session());
    expect(res.status).toBe(303);
    const cleared = res.headers.getSetCookie();
    for (const name of [SESSION, SPACE]) {
      const raw = cleared.find((c) => c.startsWith(`${name}=`))!;
      expect(raw).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    }
  });

  it("refuses a sign-out or switch posted from another site", async () => {
    for (const p of ["/auth/signout", "/auth/space", "/auth/demo"]) {
      expect((await send("POST", p, {}, session(), { origin: "https://evil.test" })).status).toBe(403);
      expect((await send("POST", p, {}, session(), { "sec-fetch-site": "cross-site", origin: "" })).status).toBe(403);
    }
  });

  it("lets a signed-in user view the demo and come back", async () => {
    const toDemo = await app.request(`${ORIGIN}/auth/space`, { method: "POST", body: new URLSearchParams({ space: "demo" }), headers: { origin: ORIGIN, cookie: cookieHeader(session()) } });
    const cookies: Record<string, string> = { ...session(), ...jar(toDemo) };
    expect(cookies[SPACE]).toBe("demo");
    const state = (await (await get("/api/state", cookies)).json()) as { meta: { space: string; user: { email: string } } };
    expect(state.meta.space).toBe("demo");
    expect(state.meta.user.email).toBe("bryan@example.com");
    const back = await app.request(`${ORIGIN}/auth/space`, { method: "POST", body: new URLSearchParams({ space: "real" }), headers: { origin: ORIGIN, cookie: cookieHeader(cookies) } });
    expect(back.headers.getSetCookie().find((c) => c.startsWith(SPACE))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

/* ----------------------------------------------------------- the spaces */

describe("demo isolation, at the API", () => {
  const probes: [string, Record<string, string>, Record<string, string>][] = [
    ["no credentials at all", {}, {}],
    ["a made-up session cookie", { [SESSION]: "forged.forged" }, {}],
    ["a real-looking session for an address off the list", session("intruder@gmail.com"), {}],
    ["a session signed with the wrong secret", session("bryan@example.com", "B", SESSION_SECONDS, "z".repeat(40)), {}],
    ["an expired session", session("bryan@example.com", "B", -60), {}],
    ["a cookie that says the space is real", { [SPACE]: "real", "bl_space": "real" }, {}],
    ["a header that names the real space", {}, { "x-space": "real", "x-real": "1" }],
    ["a signed-in user who chose to view the demo", { ...session(), [SPACE]: "demo" }, {}],
  ];

  for (const [name, cookies, headers] of probes) {
    it(`reads only the sample with ${name}`, async () => {
      const res = await get("/api/state?space=real", cookies, headers);
      expect(res.status).toBe(200);
      const t = await titles(res.clone());
      expect(t).toContain("DEMO-SAMPLE");
      expect(t).not.toContain("REAL-SECRET");
      expect(((await res.json()) as { meta: { space: string } }).meta.space).toBe("demo");
    });

    it(`writes only to the demo with ${name}`, async () => {
      const title = `probe ${name}`;
      const res = await send("POST", "/api/items?space=real", newItem(title), cookies, { "x-actor": "Visitor", ...headers });
      expect(res.status).toBe(201);
      expect(await count(demoDb, title)).toBe(1);
      expect(await count(realDb, title)).toBe(0);
      // It cannot move or edit the real item either: that id does not exist in the demo.
      expect((await send("PATCH", "/api/items/real1", { title: "pwned" }, cookies, { "x-actor": "Visitor", ...headers })).status).toBe(404);
      expect((await send("POST", "/api/items/real1/move", { to: "idea" }, cookies, { "x-actor": "Visitor", ...headers })).status).toBe(404);
      expect((await realDb.query<{ title: string }>("SELECT title FROM items WHERE id = 'real1'"))[0].title).toBe("REAL-SECRET");
    });
  }

  it("refuses a wrong write key outright instead of treating it as a demo visitor", async () => {
    const res = await send("POST", "/api/items", newItem("wrong-key-probe"), {}, { "x-actor": "S", "x-write-key": "guess" });
    expect(res.status).toBe(401);
    expect(await count(demoDb, "wrong-key-probe") + (await count(realDb, "wrong-key-probe"))).toBe(0);
  });
});

describe("the real space", () => {
  it("shows a signed-in user the real backlog and logs changes under their Google name", async () => {
    const cookies = session("bryan@example.com", "Bryan A");
    const state = (await (await get("/api/state", cookies)).json()) as { items: { title: string }[]; meta: { space: string; demo: boolean; user: { name: string } } };
    expect(state.items.map((i) => i.title)).toContain("REAL-SECRET");
    expect(state.items.map((i) => i.title)).not.toContain("DEMO-SAMPLE");
    expect(state.meta).toMatchObject({ space: "real", demo: false, user: { name: "Bryan A" } });
    // The browser's own x-actor is ignored: the audit trail is who signed in.
    const res = await send("POST", "/api/items", newItem("real-write"), cookies, { "x-actor": "Someone Else" });
    expect(res.status).toBe(201);
    expect(await count(realDb, "real-write")).toBe(1);
    expect(await count(demoDb, "real-write")).toBe(0);
    expect((await realDb.query<{ actor: string }>("SELECT actor FROM events WHERE detail LIKE 'Submitted%' ORDER BY at DESC LIMIT 1"))[0].actor).toBe("Bryan A");
  });

  it("refuses a write that a signed-in browser makes from another site", async () => {
    const res = await send("POST", "/api/items", newItem("csrf-probe"), session(), { origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect(await count(realDb, "csrf-probe") + (await count(demoDb, "csrf-probe"))).toBe(0);
  });

  it("still opens to a script with the write key, which must name who it is", async () => {
    const headers = { "x-write-key": "team-key" };
    expect(await titles(await get("/api/state", {}, headers))).toContain("REAL-SECRET");
    expect((await send("POST", "/api/items", newItem("script-write"), {}, headers)).status).toBe(400);
    expect((await send("POST", "/api/items", newItem("script-write"), {}, { ...headers, "x-actor": "Importer" })).status).toBe(201);
    expect(await count(realDb, "script-write")).toBe(1);
    expect((await realDb.query<{ actor: string }>("SELECT actor FROM events ORDER BY at DESC LIMIT 1"))[0].actor).toBe("script: Importer");
  });

  it("refuses a write key outright when there is no real space, instead of writing to the demo", async () => {
    const solo = createHosted({ demoDb, realDb: null, auth: null, writeKey: "team-key", signinHtml: SIGNIN });
    const res = await solo.request(`${ORIGIN}/api/items`, { method: "POST", body: JSON.stringify(newItem("nokey-probe")), headers: { "content-type": "application/json", "x-actor": "S", "x-write-key": "team-key" } });
    expect(res.status).toBe(503);
    expect(await count(demoDb, "nokey-probe")).toBe(0);
  });

  it("answers plainly when the real database cannot be reached, and the demo keeps working", async () => {
    const down = createHosted({ demoDb, realDb: async () => { throw new Error("connect ECONNREFUSED"); }, auth: cfg, signinHtml: SIGNIN, fetch: googleFetch });
    const res = await down.request(`${ORIGIN}/api/state`, { headers: { cookie: cookieHeader(session()) } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("not reachable");
    expect((await down.request(`${ORIGIN}/api/state`)).status).toBe(200);
  });
});

/* ----------------------------------------------- the root and demo-only */

describe("the root", () => {
  it("shows the sign-in page to anyone with no session and no demo choice, on any page", async () => {
    for (const path of ["/", "/board", "/item/abc"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("SIGNIN");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(await (await get("/api/state")).text()).not.toContain("SIGNIN"); // the API is not the page
  });

  it("opens the app after Try the demo, and after signing in", async () => {
    const demo = await app.request(`${ORIGIN}/auth/demo`, { method: "POST", headers: { origin: ORIGIN } });
    expect(demo.status).toBe(303);
    const raw = demo.headers.getSetCookie().find((c) => c.startsWith(SPACE))!;
    expect(raw).toMatch(/HttpOnly/i); expect(raw).toMatch(/Secure/i); expect(raw).toMatch(/SameSite=Lax/i);
    const probe = createHosted({ demoDb, realDb: async () => realDb, auth: cfg, signinHtml: SIGNIN, fetch: googleFetch });
    probe.get("*", (c) => c.text("SPA"));
    const open = async (cookies: Record<string, string>) => (await probe.request(`${ORIGIN}/board`, { headers: { cookie: cookieHeader(cookies) } })).text();
    expect(await open(jar(demo))).toBe("SPA");
    expect(await open(session())).toBe("SPA");
    expect(await open({})).toContain("SIGNIN");
    expect(await open(session("intruder@gmail.com"))).toContain("SIGNIN");
  });
});

describe("before setup", () => {
  it("runs demo-only, exactly as today, when DATABASE_URL or the Google settings are missing", async () => {
    for (const auth of [null, cfg]) {
      const solo = createHosted({ demoDb, realDb: null, auth, signinHtml: SIGNIN, fetch: googleFetch });
      solo.get("*", (c) => c.text("SPA"));
      expect(await (await solo.request(`${ORIGIN}/`)).text()).toBe("SPA"); // straight to the demo, no sign-in page
      expect((await solo.request(`${ORIGIN}/auth/google`)).status).not.toBe(302); // no Google route to wander into
      const state = (await (await solo.request(`${ORIGIN}/api/state`, { headers: { cookie: cookieHeader(session()) } })).json()) as { meta: { space: string; signIn: boolean } };
      expect(state.meta).toMatchObject({ space: "demo", signIn: false });
      expect((await solo.request(`${ORIGIN}/api/items`, { method: "POST", body: JSON.stringify(newItem("solo-1")), headers: { "x-actor": "V", "content-type": "application/json", "x-write-key": "x" } })).status).toBe(201);
    }
    expect(await count(demoDb, "solo-1")).toBe(2);
    const noGoogle = createHosted({ demoDb, realDb: async () => realDb, auth: null, writeKey: "team-key", signinHtml: SIGNIN });
    expect((await noGoogle.request(`${ORIGIN}/`)).status).toBe(404); // not gated, no SPA mounted in this test
    expect(await titles(await noGoogle.request(`${ORIGIN}/api/state`, { headers: { "x-write-key": "team-key" } }))).toContain("REAL-SECRET");
  });
});

describe("the settings", () => {
  it("turns sign-in on only when everything it needs is present and valid", () => {
    expect(authConfigFromEnv({})).toEqual({ config: null, problems: [] });
    expect(authConfigFromEnv({ ...ENV, GOOGLE_CLIENT_SECRET: "" }).config).toBeNull();
    expect(authConfigFromEnv({ ...ENV, GOOGLE_CLIENT_SECRET: "" }).problems).toContain("GOOGLE_CLIENT_SECRET is not set");
    expect(authConfigFromEnv({ ...ENV, SESSION_SECRET: "short" }).problems.join()).toContain("at least 32");
    expect(authConfigFromEnv({ ...ENV, PUBLIC_URL: "not a url" }).config).toBeNull();
    expect(authConfigFromEnv({ ...ENV, PUBLIC_URL: "http://gtm-backlog.onrender.com" }).config).toBeNull();
    expect(authConfigFromEnv({ ...ENV, ALLOWED_DOMAIN: "a.com,b.com" }).config).toBeNull();
    expect(authConfigFromEnv({ ...ENV, ALLOWED_EMAILS: "", ALLOWED_DOMAIN: "" }).problems.join()).toContain("ALLOWED_EMAILS or ALLOWED_DOMAIN");
    expect(authConfigFromEnv({ ...ENV, ALLOWED_EMAILS: "", ALLOWED_DOMAIN: "@Team.test" }).config?.domain).toBe("team.test");
  });
  it("builds the redirect URI from PUBLIC_URL, trailing slash or not, and marks cookies Secure only on https", () => {
    expect(authConfigFromEnv({ ...ENV, PUBLIC_URL: "https://gtm-backlog.onrender.com/" }).config?.redirectUri).toBe("https://gtm-backlog.onrender.com/auth/google/callback");
    expect(authConfigFromEnv({ ...ENV, PUBLIC_URL: "http://localhost:8921" }).config?.secure).toBe(false);
    expect(cfg.secure).toBe(true);
  });
});

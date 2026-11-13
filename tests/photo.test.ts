/* Your photo: what the server accepts, whose it is, and which photo an avatar shows. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type Space } from "../src/server/app";
import { migrate, pglite, type Db } from "../src/server/db";
import { PHOTO_MAX_BYTES, checkPhoto, pickPhoto } from "../src/shared/settings";
import { allMigrations } from "./migrations";

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const JPEG = (extra = 20) => `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0, ...new Array(extra).fill(7)])}`;
const PNG = `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])}`;

describe("checkPhoto", () => {
  it("accepts a small JPEG or PNG data URL", () => {
    expect(checkPhoto(JPEG())).toEqual({ value: JPEG() });
    expect(checkPhoto(PNG)).toEqual({ value: PNG });
  });
  it("refuses anything that is not a base64 JPEG or PNG data URL", () => {
    for (const v of [null, 5, "", "https://example.com/me.jpg", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/gif;base64,R0lGODlh", "data:text/html;base64,PGI+", "data:image/jpeg,abc", `data:image/jpeg;base64,${"!!!!"}`])
      expect(checkPhoto(v), String(v)).toHaveProperty("error");
  });
  it("refuses bytes that are not the image type claimed", () => {
    expect(checkPhoto(`data:image/jpeg;base64,${b64([1, 2, 3, 4, 5, 6])}`)).toMatchObject({ error: expect.stringContaining("not the image type") });
  });
  it("holds the size at 40 KB", () => {
    expect(checkPhoto(JPEG(PHOTO_MAX_BYTES - 10))).toHaveProperty("value");
    expect(checkPhoto(JPEG(PHOTO_MAX_BYTES))).toMatchObject({ error: expect.stringContaining("under 40 KB") });
    expect(checkPhoto(JPEG(200_000))).toMatchObject({ error: expect.stringContaining("under 40 KB") });
  });
});

describe("pickPhoto: which photo an avatar shows", () => {
  const sample = { "Sam Ortiz": "/avatars/sam-ortiz.jpg" };
  const me = { name: "Bryan Acevedo", picture: "https://lh3.example/b.jpg" };
  it("an uploaded photo beats the Google picture, even when the rail hands the Google picture in as src", () => {
    expect(pickPhoto("Bryan Acevedo", { uploaded: { "Bryan Acevedo": "data:up" }, src: me.picture, sample, me })).toBe("data:up");
  });
  it("then the Google picture, then nothing (initials)", () => {
    expect(pickPhoto("Bryan Acevedo", { uploaded: {}, sample, me })).toBe(me.picture);
    expect(pickPhoto("Bryan Acevedo", { uploaded: {}, sample, me: { name: "Bryan Acevedo" } })).toBeUndefined();
    expect(pickPhoto("Someone Else", { uploaded: { "Bryan Acevedo": "data:up" }, sample, me })).toBeUndefined();
  });
  it("matches by name only, so one person's photo never lands on another", () => {
    expect(pickPhoto("Sam Ortiz", { uploaded: { "Bryan Acevedo": "data:up" }, sample, me })).toBe("/avatars/sam-ortiz.jpg");
    expect(pickPhoto("constructor", { uploaded: {}, sample, me })).toBeUndefined();
  });
});

let db: Db, who: { email?: string; demo: boolean; name: string };
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  db = await pglite();
  await migrate(db, allMigrations());
  who = { email: "bryan@example.com", demo: false, name: "Bryan Acevedo" };
  app = createApp(() => db, { demo: false, resolve: async (): Promise<Space> => ({ db, demo: who.demo, actor: who.name, email: who.email, meta: {} }) });
});
afterAll(() => db.close());

const put = (photo: unknown) => app.request("/api/me/photo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo }) });
const state = async () => (await (await app.request("/api/state")).json()) as { meta: { photos: Record<string, string>; settings: Record<string, unknown> }; events: { actor: string; detail: string; item_id: string | null }[] };

describe("PUT and DELETE /api/me/photo", () => {
  it("stores the photo under the signed-in person's name, and the state never shows the address", async () => {
    expect((await put(JPEG())).status).toBe(200);
    const s = await state();
    expect(s.meta.photos).toEqual({ "Bryan Acevedo": JPEG() });
    expect(JSON.stringify(s)).not.toContain("bryan@example.com");
    expect(s.meta.settings).not.toHaveProperty("user_photos");
    expect(s.events.find((e) => e.detail === "Changed their photo")).toMatchObject({ actor: "Bryan Acevedo", item_id: null });
  });
  it("replaces their own photo, and keeps other people's", async () => {
    who = { email: "ana@example.com", demo: false, name: "Ana Ruiz" };
    expect((await put(PNG)).status).toBe(200);
    who = { email: "BRYAN@example.com", demo: false, name: "Bryan Acevedo" }; // the address is compared in lower case
    expect((await put(JPEG(40))).status).toBe(200);
    expect((await state()).meta.photos).toEqual({ "Bryan Acevedo": JPEG(40), "Ana Ruiz": PNG });
  });
  it("refuses a bad photo and keeps the old one", async () => {
    const res = await put("data:image/svg+xml;base64,PHN2Zz4=");
    expect(res.status).toBe(400);
    expect((await state()).meta.photos["Bryan Acevedo"]).toBe(JPEG(40));
  });
  it("takes the address from the session, never from the request", async () => {
    const res = await app.request("/api/me/photo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo: PNG, email: "ana@example.com", name: "Ana Ruiz" }) });
    expect(res.status).toBe(200);
    const photos = (await state()).meta.photos;
    expect(photos["Bryan Acevedo"]).toBe(PNG);
    expect(photos["Ana Ruiz"]).toBe(PNG); // Ana's own, unchanged
  });
  it("is not reachable through the generic settings endpoint", async () => {
    const res = await app.request("/api/settings/user_photos", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: { "x@y.z": { name: "X", photo: PNG } } }) });
    expect(res.status).toBe(404);
  });
  it("is for a signed-in person in the real space: not the demo, not a script", async () => {
    who = { email: undefined, demo: false, name: "script: n8n" };
    expect((await put(JPEG())).status).toBe(403);
    who = { email: "bryan@example.com", demo: true, name: "Bryan Acevedo" };
    expect((await put(JPEG())).status).toBe(403);
    expect((await app.request("/api/me/photo", { method: "DELETE" })).status).toBe(403);
  });
  it("removes only their own photo, and the fallback returns", async () => {
    who = { email: "bryan@example.com", demo: false, name: "Bryan Acevedo" };
    const res = await app.request("/api/me/photo", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await state()).meta.photos).toEqual({ "Ana Ruiz": PNG });
    expect((await app.request("/api/me/photo", { method: "DELETE" })).status).toBe(200); // nothing to remove is fine
  });
});

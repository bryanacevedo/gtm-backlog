/* The Cloudflare Worker (2026-11-18): every migration is bundled, built files skip the API, and the demo can never be the real database. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allMigrations } from "./migrations";
import { isFile, sameDatabase } from "../src/server/worker-rules";

describe("the Worker", () => {
  it("bundles every migration in the folder, in order", () => {
    const src = readFileSync(new URL("../src/server/migrations-bundle.ts", import.meta.url), "utf8");
    const imported = [...src.matchAll(/from "\.\.\/\.\.\/migrations\/([^"]+\.sql)"/g)].map((m) => m[1]);
    const listed = [...src.matchAll(/name: "([^"]+\.sql)"/g)].map((m) => m[1]);
    const names = allMigrations().map((m) => m.name);
    expect(imported).toEqual(names);
    expect(listed).toEqual(names);
  });
  it("sends built files to the asset store and pages and the API through the sign-in check", () => {
    for (const p of ["/assets/main-abc.js", "/assets/x.css", "/avatars/a.webp", "/favicon.svg", "/signin.html"]) expect(isFile(p), p).toBe(true);
    for (const p of ["/", "/board", "/item/bl_155", "/api/state", "/auth/google/callback", "/queue"]) expect(isFile(p), p).toBe(false);
  });
  it("refuses a demo database that is the real one", () => {
    expect(sameDatabase("postgres://a/b", " postgres://a/b ")).toBe(true);
    expect(sameDatabase("postgres://demo/b", "postgres://real/b")).toBe(false);
    expect(sameDatabase("postgres://demo/b", undefined)).toBe(false);
  });
  it("migrates and seeds only the demo database at night", () => {
    const src = readFileSync(new URL("../src/server/worker.ts", import.meta.url), "utf8");
    const night = src.slice(src.indexOf("async scheduled"));
    expect(night.match(/seedSql\(\)/g)?.length).toBe(1);
    expect(night).toMatch(/demo\.exec\(seedSql\(\)\)/);
    expect(night).not.toMatch(/real\.exec/);
  });
});

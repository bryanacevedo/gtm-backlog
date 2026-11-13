/* Builds samples/demo-snapshot.tgz: the demo's database, migrated and cleanly shut down.
   Run it again whenever a migration is added (a stale one still works: migrations apply on top). */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
const port = "8899";
const server = spawn(process.execPath, ["src/server/node.ts", "--demo"], { env: { ...process.env, PORT: port, PUBLIC_DEMO: "" }, stdio: "ignore" });
for (let i = 0; i < 180; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
await new Promise((r) => { server.on("exit", r); server.kill("SIGTERM"); });
mkdirSync("samples", { recursive: true });
execFileSync("tar", ["--no-mac-metadata", "--no-xattrs", "-czf", "samples/demo-snapshot.tgz", "-C", ".data", "demo"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
console.log("samples/demo-snapshot.tgz written");

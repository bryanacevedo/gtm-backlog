/* Every migration in the repo, in order: what the server applies on start. */
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
export const allMigrations = () =>
  readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: readFileSync(new URL(name, dir), "utf8") }));

/* Every file in migrations/, bundled into the Worker as text (wrangler.toml has a Text rule for *.sql).
   A Worker cannot read a folder, so the list is written out here; tests/worker.test.ts fails when a
   migration is added to the folder and not to this list. */

import m0001 from "../../migrations/0001_init.sql";
import m0002 from "../../migrations/0002_settings.sql";
import m0003 from "../../migrations/0003_work_links.sql";
import m0004 from "../../migrations/0004_repair_json.sql";
import m0005 from "../../migrations/0005_score_proposals.sql";

export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: "0001_init.sql", sql: m0001 },
  { name: "0002_settings.sql", sql: m0002 },
  { name: "0003_work_links.sql", sql: m0003 },
  { name: "0004_repair_json.sql", sql: m0004 },
  { name: "0005_score_proposals.sql", sql: m0005 },
];

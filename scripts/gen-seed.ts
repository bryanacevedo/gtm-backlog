/* Prints the sample backlog as SQL, dated relative to now. */
import { seedSql } from "../src/server/seed.ts";
process.stdout.write(seedSql());

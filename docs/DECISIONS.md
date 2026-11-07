# Decisions

Short records of the choices that shaped gtm-backlog: what was decided, what else was on the table, and why.

## 1. A request and a backlog item are one record

**Decision:** submitting a request creates an item in `triage`. Accepting, declining and merging are stage moves on that same record.
**Rejected:** separate `requests` and `items` tables linked by a foreign key.
**Why:** two tables would need a sync rule for every field the requester wrote, and an item that came from no request would be a special case. With one record, one history covers the item from first message to retirement.

## 2. The score is computed by the database

**Decision:** `score` is a Postgres generated column: impact × reach × confidence ÷ effort. It is null when any input is missing.
**Rejected:** storing a score the app calculates, or letting people type one.
**Why:** a typed score can drift from its inputs, and nobody can tell when it has. A generated column can't. Null-when-incomplete keeps an unscored item from pretending to rank.

## 3. Reach is always accounts per week

**Decision:** one unit for every item.
**Rejected:** a free unit per item (people, records, reps).
**Why:** mixing units makes scores incomparable. A job that touches 900 records would outrank one that books meetings with 60 target accounts. Accounts are the unit every B2B team already plans in.

## 4. The rules live in one file and are enforced three times

**Decision:** `src/shared/domain.ts` defines which moves are allowed. The API refuses invalid moves, the app predicts the result so the screen updates immediately, and Postgres `CHECK` constraints back up the two rules that matter most.
**Why:** an optimistic UI is only safe if the client and server can't disagree, and the database is the last line if anything skips the API.

## 5. Postgres everywhere, with PGlite for the demo

**Decision:** real Postgres SQL locally and in production. Locally it runs as PGlite inside the process; in production it's any `DATABASE_URL`.
**Rejected:** SQLite or D1 for the demo and Postgres for production.
**Why:** one dialect means the demo exercises exactly the schema production runs, enums and generated columns included. A clone needs only Node.

## 6. No component library

**Decision:** every component is written for this product, styled with a small set of CSS tokens.
**Rejected:** shadcn/ui and similar kits.
**Why:** the kit look is recognizable at a glance and says nothing about the product. The design rules (monochrome, color only for people and teams, no pills, motion only on change) are easier to hold with nothing to fight.

## 7. Alignment is tested, not eyeballed

**Decision:** `scripts/audit-layout.mjs` loads every view in a real browser at 1440, 1024, 412, 360 and 330px (the last approximates a phone with enlarged text). It fails on misaligned column edges, mismatched text baselines, text spilling out of its box, or sideways scroll.
**Why:** a screenshot that looks fine can hide a 3px baseline drift, and phones with bigger system text break layouts that a desktop browser never shows. The audit found 59 problems the first time it ran.

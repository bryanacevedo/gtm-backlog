# Decisions

Short records of the choices that shaped gtm-backlog: what was decided, what else was on the table, and why.

## 1. A request and a backlog item are one record

**Decision:** submitting a request creates an item in `triage`. Accepting, declining and merging are stage moves on that same record.
**Rejected:** separate `requests` and `items` tables linked by a foreign key.
**Why:** two tables would need a sync rule for every field the requester wrote, and an item that came from no request would be a special case. With one record, one history covers the item from first message to retirement.

## 2. Nobody types a score

**Decision:** the score is always computed from its four inputs: impact × reach × (confidence ÷ 100) ÷ effort, and empty when any input is missing. The app ranks with the shared `score()` function, so the queue can re-rank instantly as inputs change. Postgres carries the same formula as a generated column for reporting and SQL access, and a test runs both against real Postgres to prove they agree.
**Rejected:** a score field people type in.
**Why:** a typed score drifts from its inputs, and nobody can tell when it has. Empty-when-incomplete keeps an unscored item from pretending to rank.

## 3. Reach is always accounts per week

**Decision:** one unit for every item.
**Rejected:** a free unit per item (people, records, reps).
**Why:** mixing units makes scores incomparable. A job that touches 900 records would outrank one that books meetings with 60 target accounts. Accounts are the unit every B2B team already plans in.

## 4. The rules live in one file and are enforced three times

**Decision:** `src/shared/domain.ts` defines which moves are allowed. The API refuses invalid moves, the app predicts the result so the screen updates immediately, and Postgres `CHECK` constraints back up the ones that matter most: live needs a system link, declined or retired needs a reason, and every input stays in range.
**Why:** an optimistic UI is only safe if the client and server can't disagree, and the database is the last line if anything skips the API.

## 5. Postgres everywhere, with PGlite for the demo

**Decision:** real Postgres SQL locally and in production. Locally it runs as PGlite inside the process; in production it's any `DATABASE_URL`.
**Rejected:** SQLite or D1 for the demo and Postgres for production.
**Why:** one dialect means the demo exercises exactly the schema production runs, enums and generated columns included. A clone needs only Node 22.18 or newer. The demo always uses PGlite, even when `DATABASE_URL` is set, and sample data only goes into an external database when `SEED_SAMPLE=1` is set on purpose.

## 6. No component library

**Decision:** every component is written for this product, styled with a small set of CSS tokens.
**Rejected:** shadcn/ui and similar kits.
**Why:** the kit look is recognizable at a glance and says nothing about the product. The design rules (monochrome, color only for people and teams, no pills, motion only on change) are easier to hold with nothing to fight.

Superseded in part (2026-11-17): the colour is now people and one accent; teams use a glyph on an accent tile.

## 7. Alignment is tested, not eyeballed

**Decision:** `scripts/audit-layout.mjs` loads every view in a real browser at 1440, 1024, 412, 360 and 330px (the last approximates a phone with enlarged text). It fails on misaligned column edges, mismatched text baselines, text spilling out of its box, or sideways scroll.
**Why:** a screenshot that looks fine can hide a 3px baseline drift, and phones with bigger system text break layouts that a desktop browser never shows. The audit found 59 problems the first time it ran.

## 8. An unopened request is told by weight, not a dot

**Decision:** in Triage, a request nobody has opened yet is set in semibold; an opened one is regular. The small dot beside its age is gone. Team colours (`TEAM_COLOR`, `.tdot`) stay: they identify a team, they do not signal a state.
**Why:** a coloured or ink dot before a word is a banned AI tell (BRYAN-DESIGN-INSTRUMENT.md); weight carries the same information. Bryan approved it on 2026-11-12, and `docs/DESIGN-LINT-BASELINE.txt` is now empty. Screen readers still hear "(not opened yet)".

Superseded in part (2026-11-17): team colours were later replaced by a glyph on an accent tile, so no dot remains.

## 9. The demo says what it is, in the app, and says the truth about edits (2026-11-17)

**Decision:** the demo shows one slim bar on every screen (desktop and phone): "Sample company with invented data. Edits stay in this demo and reset every night at 06:00 UTC. Dates follow today's date.", with a Start here button; it can be hidden for the session. Write controls say the same before the click (a title on Accept and Decline, a line beside them in the demo). The real space shows none of it.
**Rejected:** copying the other desks' "changes are refused in the demo" wording.
**Why:** this demo is editable and is reset nightly, so a refusal notice would be false. The bar states what is true. The sample day is today (the demo's dates are relative), so no frozen date is shown. The words come from `src/shared/words.ts`, which also feeds the landing page and the Start here dialog so they cannot disagree.

## 10. Triage says when scores change under the reader (2026-11-17)

**Decision:** when a proposal replaces the starting values, Triage shows "Scores updated: ... proposed new values (Impact 3 to 4, ...). It now lands at #2, was #9." with a Dismiss button, and the rank preview is not re-ranked without it. Under the trust figures one line defines Drift and says who proposes: an AI model proposes, a person decides. Pressing A with an invalid value says why nothing happened.
**Rejected:** a tooltip only; holding the proposal back until the reader asks.
**Why:** the simulation found the rank jumping from #9 to #2 with no word. The sentence is built by `scoresUpdatedLine` in `src/shared/scores-updated.ts` and tested.

## 11. Plain words for the vocabulary, one source (2026-11-17)

**Decision:** Impact, Reach, Confidence, Effort, the Score formula, Silent, Measured, Drift, proposed scores, pull requests (Open PRs, Merged) and tool names are explained in the Start here dialog; the four screens each get a one-line description (also the title of the rail link). Pull request figures and tool names in request titles are labelled sample data. Names such as Slack in request titles are sample text, not a connection.
**Why:** the first-visit simulation flagged these as unexplained. The buyer path ends with a "Next step" line that uses a placeholder (`CONTACT_PLACEHOLDER`), not an invented address; replace it when there is a place to send a buyer.

## 12. The Live figures on Board and Shipped agree (2026-11-17)

**Decision:** Shipped shows Live, Measured and Silent beside each other, computed with the same function as the Board's Live column head (`columnSums`). A release with no result in the last 30 days reads "Last measured Sep 8, over 30 days ago", never a bare "Measured" next to Silent. The sidebar Teams group is labelled "Teams, open" and lists every team, so Marketing (no open request) has a link and a 0.
**Why:** "3 measured, 2 silent" on the Board beside "Live 5, Silent 2" on Shipped, and "Measured Sep 8" beside "Silent" on one release, read as disagreement.

## 13. Text colours are tested for contrast (2026-11-17)

**Decision:** `--ink-3` is now #60606A and `--ink-4` #666670 (were #71717A and #A1A1AA), so every grey text token holds 4.5:1 on the page, panel, rail and row grounds; `tests/simfix.test.ts` ("text contrast") measures it. The toast's muted icon keeps the old light grey as `--toast-mute`. Route fade-ins are 120 ms. The Score column now sits right after Stage, so it stays on screen when the table scrolls sideways; the radio inputs of the Impact and Confidence chips fill their whole chip.
**Why:** the old light grey measured about 2.5:1; Score was off screen at about 800 px; the radios measured 13 by 13 px.

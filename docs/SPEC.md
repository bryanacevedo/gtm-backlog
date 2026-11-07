# gtm-backlog: product spec

## The job

A GTM engineering team gets more requests than it can build. Sales, marketing, partnerships and RevOps each ask for "a quick automation". Nobody can see what is queued, what is being built or what shipped, and when leadership asks what GTM engineering did this month, there is no answer ready.

gtm-backlog is the single place where those requests land, get ranked by what they are worth to revenue, move from idea to live, and keep reporting what they did after they shipped.

The test for every screen: **a sales leader opens it cold and in 10 seconds knows what is being built, why that and not something else, and what shipped last month.**

## Who uses it

- **Requester** (an SDR manager, a marketer): submits a request and follows it on its page.
- **GTM engineer** (the owner): triages, scores, moves items, links the system that shipped, logs results.
- **Leader**: reads the Queue and Shipped.

v1 has no accounts. The app asks for a display name once, keeps it in the browser and sends it with every write, and the activity log records it. If `WRITE_KEY` is set on the server, writes also need that key.

## One object, six stages

A request and a backlog item are the same record. Submitting a request creates an item in `triage`. Triage accepts it into `idea` with a first score, declines it with a reason, or merges it into another item (declined, pointing at the item that covers it).

| From | Allowed moves |
|---|---|
| triage | idea, declined |
| idea | building, declined, triage |
| building | idea, live |
| live | building, retired |
| declined | triage (reopen) |
| retired | live (revive) |

- Going **live** needs a link to the shipped system. The first time an item goes live, `live_at` is set.
- **Declining** or **retiring** needs a reason, which the requester sees.
- The rules live once in `src/shared/domain.ts`. The API enforces them, the app uses the same code to move cards before the server confirms, and the database enforces the two that matter most as `CHECK` constraints.

## Score

**Score = impact × reach × (confidence ÷ 100) ÷ effort**

| Input | Type | Meaning |
|---|---|---|
| impact | 1 to 5 | 1 a convenience · 2 saves a team time · 3 improves a pipeline input · 4 creates or protects pipeline · 5 moves bookings this quarter |
| reach | number | accounts affected per week (one unit for every item, so scores compare) |
| confidence | 50, 80 or 100 | percent sure the impact is real |
| effort | days | engineering days to ship |

Nobody types a score. The app ranks with a shared function, and Postgres carries the same formula as a generated column (a test proves they agree). It is relative: it ranks items against each other and means nothing alone. If any input is missing, the item is "Unscored" and ranks after every scored item, oldest first.

**Every number carries its source and its age.** Score inputs record who set them and when. A score nobody has confirmed in 60 days renders faded and says so; saving the score again, even unchanged, confirms it. A shipped result carries its measurement date.

**Silent:** a live item with no logged result for 30 days, counted from its last result or from going live. Silent items are marked on the Board and on Shipped.

## Views

| Key | View | What it is for |
|---|---|---|
| 1 | Triage | An inbox. Requests on the left, the decision on the right, with a live preview of where the request lands in the queue before anyone accepts it. `a` accept, `m` merge, `d` decline. |
| 2 | Queue | Everything in idea and building, ranked. Every score input has its own column. |
| 3 | Board | Idea, building, live. Drag a card, or focus it and use the arrow keys. Moves apply instantly and roll back visibly if the server refuses. |
| 4 | Shipped | The leadership changelog, grouped by month, with each system's latest result. |
| | Item page | Every field edits in place, plus score, results and activity. |

## Design

Monochrome by default, in the language of current engineering tools.

- Color belongs to people (avatars) and teams (a 7px dot), never to chrome.
- Selection is a soft fill, never a colored edge. No pills for metadata, no uppercase labels.
- One action color, near-black. Hairline rings instead of heavy borders. Surfaces only where they group something real.
- Geist and Geist Mono, self-hosted. Every number is tabular; data numbers are mono.
- Motion only when state changes (150 to 280ms, ease-out): rows leave when accepted, the queue preview slides into its new order, the rank number ticks. Nothing moves at rest, and reduced-motion settings are respected.
- Alignment is measured, not eyeballed: `scripts/audit-layout.mjs` loads every view in a real browser at five widths and fails on misaligned columns, baselines, spilled text or sideways scroll.

## Not in v1

Roles and per-person accounts, multiple workspaces, Jira or Linear sync, and AI. An LLM that drafts the problem statement from a Slack thread is a good v2. Slack intake (`/request`) is planned and out of scope until the core is proven.

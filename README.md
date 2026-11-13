# gtm-backlog

[![ci](https://github.com/bryanacevedo/gtm-backlog/actions/workflows/ci.yml/badge.svg)](https://github.com/bryanacevedo/gtm-backlog/actions/workflows/ci.yml)

**The backlog for a GTM engineering team.** Requests land in one inbox, get ranked by what they're worth to revenue, move from idea to live, and keep reporting what they did after they ship.

**Live demo:** https://gtm-backlog.onrender.com (sample data, editable, resets nightly; the free plan sleeps when idle, so the first visit can take a minute)

[![Watch the 66-second walkthrough](docs/screens/video-poster.jpg)](https://gtm-backlog.onrender.com/video/gtm-backlog.mp4)

![Triage: requests on the left, the decision on the right, and a live preview of where the request lands in the queue](docs/screens/triage.png)

## The problem

Sales, marketing, partnerships and RevOps all ask GTM engineering for "a quick automation". The requests arrive in DMs, threads and meetings. Nobody can see what's queued, why one thing was built before another, or what the shipped work did. When leadership asks what GTM engineering delivered this month, someone rebuilds the answer from memory.

## What it does

- **Triage is an inbox.** Each request arrives with who asked and why. You set four inputs and watch where it would land in the queue before you accept, merge or decline it. Declines need a reason the requester can read.
- **The Queue ranks by value per day of work:** impact × reach × (confidence ÷ 100) ÷ effort. Every input has its own column, and a score nobody has confirmed in 60 days fades and says so.
- **The Board moves work from idea to building to live.** Nothing goes live without a link to the running system.
- **Shipped is the leadership changelog.** It groups work by month and shows each system's latest measured result. A live system with no result for 30 days is flagged as silent.

| | |
|---|---|
| ![Queue](docs/screens/queue.png) | ![Board](docs/screens/board.png) |
| ![Item page](docs/screens/item.png) | ![Shipped](docs/screens/shipped.png) |

## Run it

Needs Node 22.18 or newer (it runs TypeScript directly). Nothing else: no accounts, no keys, no Docker.

```bash
git clone https://github.com/bryanacevedo/gtm-backlog && cd gtm-backlog
npm install
make demo        # builds, loads the sample backlog, serves http://localhost:8787
```

The demo runs real Postgres inside the process ([PGlite](https://pglite.dev)), stored in `.data/`. It always uses that built-in database, even if your shell has `DATABASE_URL` set, so it can never reset a real one.

**Your own Postgres** (Supabase, Neon, RDS, local):

```bash
npm run build
DATABASE_URL=postgresql://… WRITE_KEY=choose-a-secret npm start
```

Migrations apply on start. Your database starts empty; add `SEED_SAMPLE=1` only if you want the sample backlog in it. With `WRITE_KEY` set, changes need that key, so leave it unset only on a private network.

**Deploy to Render:** `render.yaml` runs the demo on the free plan (`node src/server/node.ts --demo`, health check `/api/health`). The Node server reloads the sample backlog every night at 06:00 UTC and again on start, so a sleeping service wakes up fresh.

**Deploy to Cloudflare Workers:** run `DATABASE_URL=… npm run migrate` once, then `npx wrangler secret put DATABASE_URL` and `npm run deploy`. The Worker does not run migrations itself.

**Checks:** `make test` runs the unit tests, the database tests (real Postgres via PGlite) and the typecheck. `node scripts/audit-layout.mjs` checks alignment in a real browser against the running demo (`make demo` first; set `CHROME` to your Chrome binary outside macOS).

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[React app<br/>optimistic updates]
  end
  subgraph Server["Hono API (same code on Node and Cloudflare Workers)"]
    API[REST endpoints<br/>one transaction per write]
    Rules[shared/domain.ts<br/>stage rules, score]
  end
  DB[(Postgres<br/>enum, generated score,<br/>CHECK constraints, views)]
  UI -- fetch --> API
  UI -. same rules .- Rules
  API --- Rules
  API --> DB
  Cron[Nightly cron] -- reload sample data --> DB
```

| Layer | Choice | Why |
|---|---|---|
| Rules | `src/shared/domain.ts`, pure functions | The API enforces them, and the app uses the same code to apply moves before the server answers, so the two can't disagree. |
| API | Hono, one transaction per write, every write logged as an event | The activity feed doubles as the audit trail. Moves lock the row, so two people can't both win a race. |
| Database | Postgres 15+ | Stage enum; `CHECK` constraints for "live needs a system link", "declined or retired needs a reason", no self-merge and every input range. The rules hold even if someone skips the API. A generated `score` column and a ranked `queue` view mirror the app's math for reporting, and a test proves they match. |
| Local | PGlite (Postgres compiled to WebAssembly) | `make demo` works on any machine with Node and nothing else. |
| Hosted | Render (Node, PGlite) or Cloudflare Workers + Supabase Postgres | The same Hono app as local. The live demo runs on Render; a nightly timer (a cron on Workers) reloads it. |
| UI | React + Vite, no component library | Small, fast, and every component built for this product. |

More detail: [docs/SPEC.md](docs/SPEC.md) for the product, and [docs/DECISIONS.md](docs/DECISIONS.md) for the trade-offs.

## What's real and what's sample

- **Real:** the rules, the API, the database schema, the scoring, every view, keyboard control, optimistic moves with rollback, the activity log, and the nightly reset. The hosted demo leaves `WRITE_KEY` unset so visitors can try everything; it resets every night.
- **Sample:** the 24 requests and the people. The team and their names are fictional. Avatar photos are from Unsplash (see [CREDITS.md](CREDITS.md)).
- **Not built yet:** Slack intake (`/request`), roles and per-person accounts.

## Keyboard

`1` to `4` switch views, `j` and `k` move through rows (Triage, Queue, Board), `↵` opens, `←` and `→` move a card between stages, `a`, `m` and `d` decide in Triage, `c` opens a new request, `Esc` closes or goes back, `?` lists every key.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md). Read it, run it, learn from it. Using it inside a business needs a commercial license: bryan@leandrive.io.

Built by [Bryan Acevedo](https://github.com/bryanacevedo).

# gtm-backlog: status

**Live demo:** https://gtm-backlog.onrender.com (Render web service `srv-dbr7ift9fdbs73dhpd70`, free plan, Oregon, auto-deploy on push to main).
**Hosting:** `render.yaml` runs `node src/server/node.ts --demo`: PGlite inside the instance, sample backlog loaded on every start. The Node server (`src/server/node.ts`) serves the built SPA from `dist`, `/api/*`, and `/video/*` with byte ranges. The nightly reload (06:00 UTC) runs in-process (`src/server/nightly.ts`); a sleeping free service reloads on wake.
**Cloudflare:** the Worker (`wrangler.toml`, `src/server/worker.ts`, `npm run deploy`) still works and is untouched. Not retired; Bryan decides.

## History
- 2026-11-12: moved the live demo from Cloudflare Workers to Render so every desk runs on one stack.

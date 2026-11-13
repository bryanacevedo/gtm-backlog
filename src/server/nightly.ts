/* The nightly job on the Node server: reload the sample backlog at 06:00 UTC
   (02:00 in Santo Domingo), the same job the Cloudflare cron runs.
   A free Render service sleeps, so a timer alone can miss a night; on start the
   server also checks whether the sample is older than the last 06:00 UTC mark. */

export const NIGHTLY_HOUR_UTC = 6;

/** The next 06:00 UTC strictly after `nowMs`. */
export function nextNightly(nowMs: number): number {
  const d = new Date(nowMs);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), NIGHTLY_HOUR_UTC);
  if (t <= nowMs) t += 86_400_000;
  return t;
}

/** The most recent 06:00 UTC at or before `nowMs`. */
export function lastNightly(nowMs: number): number {
  return nextNightly(nowMs) - 86_400_000;
}

/** The sample's freshest request is created one day before the seed ran, at 09:00 UTC.
    The seed is stale when it ran on a day before the last 06:00 UTC mark's day. */
export function sampleIsStale(freshestCreatedMs: number | null, nowMs: number): boolean {
  if (freshestCreatedMs == null) return true;
  const seedDay = Math.floor((freshestCreatedMs + 86_400_000) / 86_400_000);
  const markDay = Math.floor(lastNightly(nowMs) / 86_400_000);
  return seedDay < markDay;
}

/** Run `job` at every 06:00 UTC. Returns a stop function. */
export function scheduleNightly(job: () => Promise<void>, now: () => number = Date.now): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    timer = setTimeout(async () => {
      try { await job(); } catch (e) { console.error("Nightly reload failed:", e); }
      arm();
    }, nextNightly(now()) - now());
  };
  arm();
  return () => clearTimeout(timer);
}

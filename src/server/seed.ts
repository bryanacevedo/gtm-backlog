/* Sample data:  24 sample GTM engineering requests, dated relative
   to the moment it runs, so the demo always looks like a live team's week.
   Generic work any B2B team recognizes; no real company, person or number. */

type Row = {
  title: string; problem: string; team: string; requester: string; touches: string[];
  stage: "triage" | "idea" | "building" | "live" | "declined" | "retired";
  owner?: string; impact?: number; reach?: number; confidence?: number; effort?: number;
  scoredDaysAgo?: number; createdDaysAgo: number; stageDaysAgo: number; liveDaysAgo?: number; acceptDaysAgo?: number;
  system?: string; note?: string; target?: number; link?: string;
  log?: { daysAgo: number; metric: string; value: number; unit: string; note?: string }[];
  work?: W[];
};
/* The work behind a build, in the sample: invented repos, pull requests and sessions (example org, no real address). */
type W = { kind: "repo" | "pr" | "session" | "doc"; url: string; title: string; daysAgo: number; state?: "open" | "merged" | "closed"; number?: number; branch?: string; draft?: boolean };
const gh = (repo: string) => `https://github.com/example/${repo}`;
const repo = (name: string, branch: string, daysAgo: number): W => ({ kind: "repo", url: `${gh(name)}/tree/${branch}`, title: `example/${name}`, branch, daysAgo });
const pr = (name: string, number: number, title: string, state: "open" | "merged" | "closed", daysAgo: number, draft = false): W => ({ kind: "pr", url: `${gh(name)}/pull/${number}`, title, state, number, daysAgo, draft });
const session = (id: string, title: string, daysAgo: number): W => ({ kind: "session", url: `https://claude.ai/code/session_demo_${id}`, title, daysAgo });

const rows: Row[] = [
  // ---- building
  { title: "CRM duplicate merge job", problem: "Reps work the same company under three account records, so activity and ownership split and reports double-count.", team: "RevOps", requester: "Dana Whitfield", touches: ["data quality", "reporting"], stage: "building", owner: "Sam Ortiz", impact: 3, reach: 140, confidence: 80, effort: 6, scoredDaysAgo: 9, createdDaysAgo: 24, stageDaysAgo: 3, target: 6,
    log: [{ daysAgo: 1, metric: "Duplicate accounts found in the dry run", value: 1284, unit: "accounts" }, { daysAgo: 1, metric: "Merges that need no person", value: 1102, unit: "accounts" }, { daysAgo: 1, metric: "Owner conflicts left for a person", value: 182, unit: "accounts" }],
    work: [repo("crm-dedupe", "merge-job", 3), pr("crm-dedupe", 18, "Nightly schedule and Slack summary", "open", 0, true), pr("crm-dedupe", 17, "Reassign activity and owners on merge", "open", 1), pr("crm-dedupe", 14, "Dry run that writes a merge report", "merged", 1), pr("crm-dedupe", 12, "Match accounts on domain and normalised name", "merged", 2),
      session("dedupe3", "Fix owner reassignment on merged accounts", 0), session("dedupe2", "Dry run against the sandbox CRM", 1), session("dedupe1", "Design the match rules", 3)] },
  { title: "Event attendee list to sequences", problem: "After every event the list sits in a spreadsheet for a week. By the time anyone reaches out, the conversation is cold.", team: "Field Marketing", requester: "Priya Raman", touches: ["pipeline", "speed"], stage: "building", owner: "Sam Ortiz", impact: 5, reach: 60, confidence: 80, effort: 9, scoredDaysAgo: 12, createdDaysAgo: 19, stageDaysAgo: 6, target: 10,
    work: [repo("event-sequencer", "attendee-sync", 6), pr("event-sequencer", 9, "Push attendee lists into sequences", "open", 1), pr("event-sequencer", 7, "Read badge-scan exports", "merged", 4),
      session("events2", "Map badge-scan columns to contact fields", 4), session("events1", "Plan the sequence hand-off", 6)] },
  { title: "Inbound lead response under 5 minutes", problem: "Demo requests wait up to a day for a first touch. Most of them book with someone else.", team: "SDR", requester: "Marcus Bell", touches: ["pipeline", "speed"], stage: "building", owner: "Lena Fischer", impact: 5, reach: 35, confidence: 80, effort: 5, scoredDaysAgo: 15, createdDaysAgo: 31, stageDaysAgo: 11, target: 4,
    log: [{ daysAgo: 4, metric: "Median time to first touch in the test week", value: 22, unit: "min", note: "Down from about a day; the on-call rota is not wired in yet." }],
    work: [repo("inbound-speed", "five-minute-reply", 11), pr("inbound-speed", 23, "Route demo requests to the on-call rep", "open", 2), pr("inbound-speed", 21, "Send an instant acknowledgement", "merged", 6), pr("inbound-speed", 19, "Read the business-hours calendar", "merged", 9),
      session("inbound2", "Wire the on-call rota into routing", 2), session("inbound1", "Measure first-touch time from the CRM", 8)] },

  // ---- idea (the ranked queue)
  { title: "Partner request intake", problem: "Partner referrals arrive by email and DM and nobody logs them, so we cannot say which partners send pipeline.", team: "Partnerships", requester: "Tomás Rivera", touches: ["pipeline", "reporting"], stage: "idea", impact: 4, reach: 15, confidence: 100, effort: 2, scoredDaysAgo: 1, createdDaysAgo: 6, stageDaysAgo: 1 },
  { title: "Webinar no-show follow-up", problem: "Half of registrants do not attend and get nothing afterwards. The recording link alone would recover some of them.", team: "Demand Gen", requester: "Hannah Cole", touches: ["pipeline"], stage: "idea", impact: 3, reach: 40, confidence: 80, effort: 3, scoredDaysAgo: 9, createdDaysAgo: 14, stageDaysAgo: 9 },
  { title: "Intent digest to Slack", problem: "Intent data lives in a tool nobody opens. A weekly digest of surging accounts in the sales channel would get it read.", team: "Sales", requester: "Chris Nolan", touches: ["pipeline"], stage: "idea", impact: 3, reach: 80, confidence: 80, effort: 2, scoredDaysAgo: 4, createdDaysAgo: 8, stageDaysAgo: 4 },
  { title: "Territory lead routing", problem: "New leads are assigned round-robin, so reps get accounts outside their territory and hand them off by hand.", team: "Sales", requester: "Chris Nolan", touches: ["speed", "data quality"], stage: "idea", impact: 4, reach: 70, confidence: 50, effort: 8, scoredDaysAgo: 12, createdDaysAgo: 27, stageDaysAgo: 12 },
  { title: "Champion job-change alerts", problem: "When a champion moves to a new company we hear about it months later, if at all.", team: "Sales", requester: "Ava Lindqvist", touches: ["pipeline"], stage: "idea", impact: 5, reach: 8, confidence: 50, effort: 5, scoredDaysAgo: 2, createdDaysAgo: 3, stageDaysAgo: 2 },
  { title: "Closed-lost win-back sequence", problem: "Deals lost on timing are never revisited. A 90-day check-in would reopen some of them.", team: "Sales", requester: "Ava Lindqvist", touches: ["pipeline"], stage: "idea", impact: 4, reach: 12, confidence: 80, effort: 3, scoredDaysAgo: 71, createdDaysAgo: 88, stageDaysAgo: 71 },
  { title: "Meeting no-show rebooking", problem: "First meetings that no-show are rebooked by hand, when someone remembers.", team: "SDR", requester: "Marcus Bell", touches: ["meetings"], stage: "idea", impact: 3, reach: 18, confidence: 100, effort: 2, scoredDaysAgo: 5, createdDaysAgo: 10, stageDaysAgo: 5 },
  { title: "Account research brief before first call", problem: "Reps spend 20 minutes per account pulling the same five facts before a first call.", team: "SDR", requester: "Jordan Pike", touches: ["speed", "meetings"], stage: "idea", impact: 2, reach: 50, confidence: 80, effort: 4, scoredDaysAgo: 7, createdDaysAgo: 13, stageDaysAgo: 7 },
  { title: "Customer expansion signals", problem: "CS learns about new teams adopting the product from the customer, after a competitor already pitched them.", team: "Customer Success", requester: "Noor Haddad", touches: ["pipeline"], stage: "idea", owner: undefined, createdDaysAgo: 4, stageDaysAgo: 2, impact: 4, reach: 25, confidence: undefined, effort: 6 },
  { title: "Event pipeline attribution", problem: "We cannot answer which events created pipeline, so the events budget is defended with anecdotes.", team: "Field Marketing", requester: "Priya Raman", touches: ["reporting"], stage: "idea", createdDaysAgo: 5, stageDaysAgo: 3 },

  // ---- triage (new requests)
  { title: "Sync event leads to the CRM same day", problem: "Badge scans reach the CRM a week after the event. Can they land the same day?", team: "Field Marketing", requester: "Priya Raman", touches: ["speed", "data quality"], stage: "triage", createdDaysAgo: 1, stageDaysAgo: 1, link: "https://example.slack.com/archives/C0GTM/p1" },
  { title: "Slack alert when a target account visits pricing", problem: "We only find out an account was on the pricing page if someone checks the analytics tool.", team: "Sales", requester: "Chris Nolan", touches: ["pipeline", "speed"], stage: "triage", createdDaysAgo: 2, stageDaysAgo: 2 },
  { title: "Clean job titles for segmentation", problem: "Job titles come in 400 spellings, so persona-based campaigns miss most of the list.", team: "Marketing", requester: "Hannah Cole", touches: ["data quality"], stage: "triage", createdDaysAgo: 3, stageDaysAgo: 3 },

  // ---- live (shipped, with results)
  { title: "Reply classification for outbound", problem: "Reps read every reply to find the few interested ones. Out-of-office and unsubscribe replies bury the hot leads.", team: "SDR", requester: "Marcus Bell", touches: ["speed", "meetings"], stage: "live", owner: "Lena Fischer", impact: 4, reach: 200, confidence: 80, effort: 7, scoredDaysAgo: 80, createdDaysAgo: 96, stageDaysAgo: 52, liveDaysAgo: 52, system: "https://github.com/example/reply-classifier",
    log: [{ daysAgo: 45, metric: "Replies sorted automatically", value: 91, unit: "%" }, { daysAgo: 16, metric: "Rep time saved per week", value: 11, unit: "hours", note: "Measured across the SDR team over two weeks." }],
    work: [repo("reply-classifier", "main", 52), pr("reply-classifier", 31, "Add the unsubscribe class", "merged", 50), pr("reply-classifier", 28, "Classify replies with the labelled set", "merged", 56), session("reply1", "Label 400 replies and tune the classes", 58)] },
  { title: "Demo request routing", problem: "Demo requests landed in a shared inbox and waited for whoever looked first.", team: "SDR", requester: "Jordan Pike", touches: ["speed", "meetings"], stage: "live", owner: "Sam Ortiz", impact: 4, reach: 35, confidence: 100, effort: 3, scoredDaysAgo: 70, createdDaysAgo: 75, stageDaysAgo: 41, liveDaysAgo: 41, system: "https://example.com/workflows/demo-routing",
    log: [{ daysAgo: 30, metric: "Median time to first touch", value: 14, unit: "min", note: "Down from about a day." }, { daysAgo: 8, metric: "Meetings booked from demo requests", value: 23, unit: "meetings" }],
    work: [repo("demo-routing", "main", 41), pr("demo-routing", 8, "Route by territory and round robin", "merged", 44), pr("demo-routing", 6, "Alert in Slack when nobody picks up", "merged", 47), session("routing1", "Build the routing rules", 48)] },
  { title: "Weekly pipeline digest", problem: "The Monday pipeline review starts with ten minutes of pulling numbers.", team: "RevOps", requester: "Dana Whitfield", touches: ["reporting"], stage: "live", owner: "Lena Fischer", impact: 2, reach: 400, confidence: 100, effort: 2, scoredDaysAgo: 98, createdDaysAgo: 110, stageDaysAgo: 88, liveDaysAgo: 88, system: "https://example.com/dashboards/pipeline",
    log: [{ daysAgo: 70, metric: "Leaders reading it weekly", value: 6, unit: "leaders" }],
    work: [repo("pipeline-digest", "main", 88), pr("pipeline-digest", 3, "Send the Monday digest", "merged", 90), session("digest1", "Pull the pipeline figures", 92)] },
  { title: "Bounced email cleanup", problem: "Hard bounces stayed in sequences and hurt sender reputation.", team: "Marketing", requester: "Hannah Cole", touches: ["data quality"], stage: "live", owner: "Sam Ortiz", impact: 3, reach: 300, confidence: 100, effort: 2, scoredDaysAgo: 30, createdDaysAgo: 36, stageDaysAgo: 5, liveDaysAgo: 5, system: "https://github.com/example/bounce-cleanup",
    log: [{ daysAgo: 2, metric: "Bounce rate", value: 1.2, unit: "%", note: "From 4.8% the month before." }],
    work: [repo("bounce-cleanup", "main", 5), pr("bounce-cleanup", 5, "Suppress hard bounces after one send", "merged", 6), pr("bounce-cleanup", 4, "Try soft-bounce retries", "closed", 9), session("bounce1", "Find the bounce codes worth suppressing", 10)] },
  { title: "Partner-sourced deal tagging", problem: "Partner-sourced deals were not tagged, so partners got no credit.", team: "Partnerships", requester: "Tomás Rivera", touches: ["reporting"], stage: "live", owner: "Lena Fischer", impact: 3, reach: 10, confidence: 80, effort: 1, scoredDaysAgo: 40, createdDaysAgo: 44, stageDaysAgo: 34, liveDaysAgo: 34, system: "https://example.com/crm/partner-tagging",
    work: [{ kind: "doc", url: "https://example.com/docs/partner-tagging", title: "Partner tagging runbook", daysAgo: 36 }, session("partner1", "Add the partner field to deals", 38)] },

  // ---- declined and retired
  { title: "Rebuild the CRM from scratch", problem: "The CRM is messy. Can we start over?", team: "Sales", requester: "Chris Nolan", touches: ["data quality"], stage: "declined", createdDaysAgo: 40, stageDaysAgo: 38, note: "Too broad to build. The duplicate merge job and title cleanup cover the parts that hurt most." },
  { title: "Event leads into the CRM", problem: "Get event leads into the CRM faster.", team: "Field Marketing", requester: "Priya Raman", touches: ["speed"], stage: "declined", createdDaysAgo: 21, stageDaysAgo: 19, note: "MERGE:Event attendee list to sequences" },
  { title: "Manual lead score spreadsheet", problem: "A shared sheet where reps scored leads by hand.", team: "SDR", requester: "Marcus Bell", touches: ["pipeline"], stage: "retired", owner: "Sam Ortiz", impact: 2, reach: 30, confidence: 50, effort: 1, scoredDaysAgo: 160, createdDaysAgo: 170, stageDaysAgo: 20, liveDaysAgo: 150, system: "https://example.com/sheets/lead-score", note: "Replaced by reply classification and demo routing." },
];

export function seedSql(nowMs: number = Date.now()): string {
  const now = nowMs;
  const iso = (daysAgo: number, hour = 10) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10) + `T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);
  const q = (v: unknown) => v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  const id = (n: number) => `bl_${String(n + 1).padStart(3, "0")}`;
  
  const out: string[] = ["-- Generated by scripts/gen-seed.ts. Sample data, not a real team.", "TRUNCATE events, ship_log, work_links, settings, items;"];
  const idByTitle = new Map(rows.map((r, i) => [r.title, id(i)]));
  let ev = 0, lg = 0;
  const addEvent = (item: string, daysAgo: number, actor: string, kind: string, detail: string) =>
    out.push(`INSERT INTO events VALUES (${q(`ev_${++ev}`)}, ${q(item)}, ${q(iso(daysAgo, 11 + (ev % 6)))}, ${q(actor)}, ${q(kind)}, ${q(detail)});`);
  
  let wl = 0;
  rows.forEach((r, i) => {
    const merged = r.note?.startsWith("MERGE:") ? idByTitle.get(r.note.slice(6)) ?? null : null;
    const note = merged ? `Merged into “${r.note!.slice(6)}”.` : r.note ?? null;
    const scored = r.impact != null || r.reach != null || r.confidence != null || r.effort != null;
    out.push(`INSERT INTO items (id,title,problem,team,requester,touches,link,stage,owner,impact,reach,confidence,effort_days,scored_at,scored_by,system_url,target_date,decision_note,merged_into,live_at,created_at,updated_at,stage_changed_at) VALUES (${[
      id(i), r.title, r.problem, r.team, r.requester, `{${r.touches.map((t) => `"${t}"`).join(",")}}`, r.link ?? null, r.stage, r.owner ?? null,
      r.impact ?? null, r.reach ?? null, r.confidence ?? null, r.effort ?? null,
      scored ? iso(r.scoredDaysAgo ?? r.stageDaysAgo, 15) : null, scored ? (r.owner ?? "Sam Ortiz") : null,
      r.system ?? null, r.target != null ? day(-r.target) : null, note, merged,
      r.liveDaysAgo != null ? iso(r.liveDaysAgo, 16) : null,
      iso(r.createdDaysAgo, 9), iso(Math.min(r.stageDaysAgo, r.scoredDaysAgo ?? 999, r.log?.at(-1)?.daysAgo ?? 999), 16), iso(r.stageDaysAgo, 16),
    ].map(q).join(", ")});`);
    addEvent(id(i), r.createdDaysAgo, r.requester, "created", "Submitted the request");
    // The triage decision is dated to match "since" on the item page: an idea or a declined request was decided the day it entered its stage.
    // Items that went on to be built were accepted a little before the build move, never before they were requested.
    const buildDaysAgo = r.liveDaysAgo != null ? r.liveDaysAgo + 3 : r.stageDaysAgo;
    const decidedDaysAgo = r.stage === "idea" || r.stage === "declined" ? r.stageDaysAgo : r.acceptDaysAgo ?? Math.min(r.createdDaysAgo, buildDaysAgo + 2);
    if (r.stage !== "triage") addEvent(id(i), decidedDaysAgo, "Sam Ortiz", "triaged", r.stage === "declined" ? (merged ? "Merged" : "Declined") : "Accepted into Idea");
    if (r.stage === "building" || r.stage === "live" || r.stage === "retired") addEvent(id(i), buildDaysAgo, r.owner ?? "Sam Ortiz", "moved", "Idea → Building");
    if (r.liveDaysAgo != null) addEvent(id(i), r.liveDaysAgo, r.owner ?? "Sam Ortiz", "moved", "Building → Live");
    if (r.stage === "retired") addEvent(id(i), r.stageDaysAgo, r.owner ?? "Sam Ortiz", "moved", "Live → Retired");
    for (const w of r.work ?? []) {
      const meta: Record<string, unknown> = { date: day(w.daysAgo) };
      if (w.kind === "repo") Object.assign(meta, { repo: w.title, branch: w.branch });
      if (w.kind === "pr") Object.assign(meta, { repo: w.url.split("/").slice(3, 5).join("/"), number: w.number, draft: w.draft === true });
      out.push(`INSERT INTO work_links (id,item_id,kind,url,title,state,meta,created_at,created_by) VALUES (${[`wl_${++wl}`, id(i), w.kind, w.url, w.title, w.state ?? null, JSON.stringify(meta), iso(w.daysAgo, 12), r.owner ?? "Sam Ortiz"].map(q).join(", ")});`);
    }
    for (const l of r.log ?? []) {
      out.push(`INSERT INTO ship_log VALUES (${[`sl_${++lg}`, id(i), day(l.daysAgo), l.metric, l.value, l.unit, l.note ?? null, r.system ?? null, iso(l.daysAgo, 17)].map(q).join(", ")});`);
      addEvent(id(i), l.daysAgo, r.owner ?? "Sam Ortiz", "logged", `Logged ${l.metric}: ${l.value}${l.unit === "%" ? "%" : ` ${l.unit}`}`);
    }
  });
  
  return out.join("\n") + "\n";
}

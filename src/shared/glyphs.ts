/* Team glyphs: the closed set of sixteen line drawings a team tile can carry (24 grid, stroke only; the stroke width comes
   from the tile size in CSS). Drawn in the design review (avatars/glyphs.json), copied here as data. Pure functions, no I/O,
   shared by the API (which validates every write) and the app (which draws the tile). A team's glyph is a per-install
   setting (`team_glyphs`) beside its colour, and like a colour it belongs to one team at most. */

export interface Glyph { id: string; label: string; /** Regex sources, tested case-insensitively against the team name. */ match: string[]; /** One path on a 24 grid. */ d: string }

export const GLYPHS: readonly Glyph[] = [
  { id: "merge", label: "Revenue operations", match: ["rev(enue)?\\s*ops", "operations", "\\bops\\b"], d: "M3.5 6.5h3c4.5 0 4.5 5.5 9 5.5h5M3.5 17.5h3c4.5 0 4.5-5.5 9-5.5" },
  { id: "outbound", label: "SDR, outbound", match: ["\\b[sbx]dr\\b", "outbound", "prospect", "business development"], d: "M6.5 17.5l11-11M9 6.5h8.5V15" },
  { id: "flag", label: "Field, events", match: ["field", "events?\\b", "regional", "trade ?shows?"], d: "M6 21V4M6 5h12l-3.5 4 3.5 4H6" },
  { id: "magnet", label: "Demand gen", match: ["demand", "growth", "lead gen", "acquisition", "inbound"], d: "M6 4v8a6 6 0 0 0 12 0V4M3.5 8.5h5M15.5 8.5h5" },
  { id: "renew", label: "Customer success", match: ["customer success", "\\bcsm?\\b", "account management", "renewal", "retention", "\\bcx\\b"], d: "M19.5 12a7.5 7.5 0 1 1-7.5-7.5c2.1 0 4.11.83 5.62 2.28L19.5 8.67M19.5 4.5v4.17h-4.17" },
  { id: "rings", label: "Partnerships", match: ["partner", "alliance", "channel", "ecosystem", "reseller"], d: "M15 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM21 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z" },
  { id: "bubble", label: "Support", match: ["support", "help ?desk", "service", "\\bcare\\b"], d: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4.5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
  { id: "steps", label: "Ways of working, process", match: ["ways of working", "process", "enablement", "training", "onboarding", "\\bpmo\\b"], d: "M3.5 19h5v-5h5.5V9H19V4h1.5" },
  { id: "broadcast", label: "Marketing, campaign", match: ["marketing", "campaign", "brand", "content", "comm(unication)?s\\b"], d: "M5 12h1.5M9.68 7.02a6.5 6.5 0 0 1 0 9.96M14.34 3.16a12.5 12.5 0 0 1 0 17.68" },
  { id: "bars", label: "Data", match: ["data", "analytics", "insights?", "\\bbi\\b", "reporting", "intelligence"], d: "M6 20v-5M12 20V10M18 20V4" },
  { id: "cube", label: "Product", match: ["product", "engineering", "platform", "design"], d: "M12 3.5l7.5 4.25v8.5L12 20.5l-7.5-4.25v-8.5zM12 12l7.5-4.25M12 12v8.5M12 12L4.5 7.75" },
  { id: "note", label: "Finance", match: ["finance", "billing", "accounting", "deal desk", "fp&a"], d: "M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" },
  { id: "rank", label: "Leadership", match: ["leadership", "\\bexecs?\\b", "c-?suite", "founders?", "\\bc[erm]o\\b", "strategy"], d: "M5 12.5l7-7 7 7M5 19l7-7 7 7" },
  { id: "bolt", label: "System, automation", match: ["automation", "systems?\\b", "\\bai\\b", "agents?\\b", "tooling", "integration", "internal tools"], d: "M13 3.5L5.5 13.5H11l-1 7 8-10.5h-5.5z" },
  { id: "pipeline", label: "Sales, pipeline", match: ["sales", "account exec", "\\baes?\\b", "pipeline", "deals?\\b", "enterprise", "mid-?market", "\\bsmb\\b"], d: "M4 6h16M7.5 12h9M11 18h2" },
  { id: "diamond", label: "General", match: [], d: "M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" },
];
export const GLYPH_IDS: string[] = GLYPHS.map((g) => g.id);
export const glyphById = (id: string | null | undefined): Glyph | undefined => GLYPHS.find((g) => g.id === id);

/** The AI owner's cursor, drawn in the ink disc. Not a team glyph. */
export const AGENT_GLYPH = "M6.5 8l5 4-5 4M13.5 16.5h4.5";
/** Owners that are an AI, not a person. */
export const AGENT_NAMES: readonly string[] = ["Claude"];

/** Initials of the words (a camel-case break is a word break), or the first two letters of a single word. Shown only when a team has no glyph. */
export function monogram(name: string): string {
  const w = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s-]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export interface TeamGlyphState {
  /** The glyph id each team shows, or null for the monogram. */
  glyph: Record<string, string | null>;
  /** Which team holds each glyph. */
  holder: Record<string, string>;
  /** Glyphs no team holds. */
  free: string[];
}

/** Stored picks first (a null pick is the monogram, chosen), then each remaining team's default by name: the first glyph in set order
    whose pattern matches and that no other team holds. No match, or every match held, is the monogram. Same on the server and in the app. */
export function resolveTeamGlyphs(stored: Record<string, string | null> | null | undefined, teams: string[]): TeamGlyphState {
  const glyph: Record<string, string | null> = {}, holder: Record<string, string> = {};
  for (const t of teams) {
    if (!stored || !Object.hasOwn(stored, t)) continue;
    const v = stored[t];
    if (v === null) glyph[t] = null;
    else if (typeof v === "string" && GLYPH_IDS.includes(v) && !holder[v]) { glyph[t] = v; holder[v] = t; }
  }
  for (const t of teams) {
    if (t in glyph) continue;
    const hit = GLYPHS.find((g) => !holder[g.id] && g.match.some((m) => new RegExp(m, "i").test(t)));
    glyph[t] = hit ? hit.id : null;
    if (hit) holder[hit.id] = t;
  }
  return { glyph, holder, free: GLYPH_IDS.filter((id) => !holder[id]) };
}

/** Validates a whole team_glyphs value: a glyph id from the set, or null for the letters, one team per glyph. Returns the cleaned map, or an error in words. */
export function checkTeamGlyphs(v: unknown): { value: Record<string, string | null> } | { error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "Team glyphs are a list of team and glyph." };
  const out: Record<string, string | null> = {}, seen = new Map<string, string>();
  for (const [team, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!team.trim() || team.length > 60) return { error: "A team name is missing or too long." };
    if (raw === null) { out[team] = null; continue; }
    if (typeof raw !== "string" || !GLYPH_IDS.includes(raw)) return { error: `${team}: pick one of the ${GLYPH_IDS.length} glyphs offered, or letters.` };
    const other = seen.get(raw);
    if (other) return { error: `The ${glyphById(raw)!.label.toLowerCase()} glyph is already ${other}'s. Two teams cannot share one.` };
    seen.set(raw, team); out[team] = raw;
  }
  return { value: out };
}

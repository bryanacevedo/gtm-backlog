/* Per-install settings: the accent colour, the team colours and the team glyphs. Pure functions, no I/O, shared by the API (which
   validates every write) and the app (which previews a choice and says why one is refused). */

import { checkTeamGlyphs } from "./glyphs.ts";

/* ------------------------------------------------------------------ colour */

export const HEX6 = /^#[0-9a-f]{6}$/i;

/** "c2410c", "#C2410C" -> "#C2410C"; null when it is not a six-digit hex colour. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
}

const channel = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
/** Contrast ratio of white text on this colour (WCAG), 1 to 21. */
export const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

export const MIN_CONTRAST = 4.5;

/** The hover shade of an accent: lighter for a near-black accent, a little darker for any other, so white text keeps its contrast. */
export function accentHover(hex: string): string {
  const [r, g, b] = rgb(hex);
  const to = luminance(hex) < 0.06 ? 255 : 0, k = luminance(hex) < 0.06 ? 0.2 : 0.14;
  return "#" + [r, g, b].map((c) => Math.round(c + (to - c) * k).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* ------------------------------------------------------------------ accent */

/** The product's own accent: near-black ink. Used when no setting is stored and no ACCENT is configured. */
export const DEFAULT_ACCENT = "#18181B";

/* Warm hues are allowed here and only here: the accent is interaction colour, never state (BRYAN-DESIGN-INSTRUMENT T1, T4). */
export const ACCENT_SWATCHES: { name: string; hex: string }[] = [
  { name: "Ink", hex: DEFAULT_ACCENT },
  { name: "Blue", hex: "#1D4ED8" },
  { name: "Teal", hex: "#0F766E" },
  { name: "Green", hex: "#15803D" },
  { name: "Violet", hex: "#6D28D9" },
  { name: "Plum", hex: "#86198F" },
  { name: "Red", hex: "#B91C1C" },
  { name: "Deep orange", hex: "#C2410C" },
];

/** A message when this cannot be the accent, else null. Accepts "#C2410C" or "c2410c". */
export function accentError(v: unknown): string | null {
  const hex = normalizeHex(v);
  if (!hex) return "Use a six-digit colour such as #C2410C.";
  const c = contrastWithWhite(hex);
  if (c < MIN_CONTRAST) return `Too light for white text. White on this colour reads at ${c.toFixed(1)} to 1; the minimum is 4.5 to 1.`;
  return null;
}

/* ------------------------------------------------------------ team colours */

/* The validated palette (directions/m05-validator.txt): the default eight plus two spares, in picker order.
   No free hex: a team's colour is one of these, and two teams cannot hold the same one. */
export const TEAM_PALETTE: { name: string; hex: string }[] = [
  { name: "Blue", hex: "#0337DC" },
  { name: "Violet", hex: "#805EF9" },
  { name: "Berry", hex: "#8B2F52" },
  { name: "Magenta", hex: "#E83CCB" },
  { name: "Purple", hex: "#7C09AA" },
  { name: "Orchid", hex: "#A663AC" },
  { name: "Forest", hex: "#306406" },
  { name: "Indigo", hex: "#5658AB" },
  { name: "Green", hex: "#0F9B23" },
  { name: "Sky", hex: "#1A89C5" },
];
export const PALETTE_HEX = TEAM_PALETTE.map((p) => p.hex);
export const paletteName = (hex: string) => TEAM_PALETTE.find((p) => p.hex === hex)?.name ?? hex;

/** Where each team starts. A team not listed here gets a colour only if one is still free, else a fallback. */
export const DEFAULT_TEAM_COLORS: Record<string, string> = {
  Sales: "#0337DC", SDR: "#1A89C5", Marketing: "#E83CCB", "Field Marketing": "#805EF9", "Demand Gen": "#7C09AA",
  RevOps: "#0F9B23", Partnerships: "#306406", "Customer Success": "#8B2F52",
  "Ways of working": "#A663AC", "CRM Desk": "#5658AB",
};

/* A team that has no palette colour (more teams than colours) still gets a stable identity colour, never grey and never warm. */
const FALLBACK = ["#4F46E5", "#0284C7", "#0891B2", "#9333EA", "#059669", "#C026D3", "#2563EB", "#0D9488"];
export function fallbackColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

export interface TeamColorState {
  /** The colour each team shows. Teams outside the palette show a fallback. */
  color: Record<string, string>;
  /** Palette colours no team holds. */
  free: string[];
  /** Which team holds each palette colour. */
  holder: Record<string, string>;
  /** Teams that hold a palette colour (and so can change it); the others can once a colour is free. */
  inPalette: Set<string>;
}

/** Stored picks first, then each remaining team's default if nobody holds it, then a stable fallback. Same on the server and in the app. */
export function resolveTeamColors(stored: Record<string, string> | null | undefined, teams: string[]): TeamColorState {
  const color: Record<string, string> = {}, holder: Record<string, string> = {}, inPalette = new Set<string>();
  const take = (team: string, hex: string) => { color[team] = hex; holder[hex] = team; inPalette.add(team); };
  for (const t of teams) { const h = normalizeHex(stored?.[t]); if (h && PALETTE_HEX.includes(h) && !holder[h]) take(t, h); }
  for (const t of teams) { const d = DEFAULT_TEAM_COLORS[t]; if (!color[t] && d && !holder[d]) take(t, d); }
  for (const t of teams) if (!color[t]) color[t] = fallbackColor(t);
  return { color, free: PALETTE_HEX.filter((h) => !holder[h]), holder, inPalette };
}

/** Retained and unused: the app draws every team tile in the accent (Bryan, 2026-11-13), so no screen reads or writes team colours any more.
    The setting, its validation and its tests stay so a stored value is never lost and the choice can come back. */
/** Validates a whole team_colors value. Returns the cleaned map, or an error in words. */
export function checkTeamColors(v: unknown): { value: Record<string, string> } | { error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "Team colours are a list of team and colour." };
  const out: Record<string, string> = {}, seen = new Map<string, string>();
  for (const [team, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!team.trim() || team.length > 60) return { error: "A team name is missing or too long." };
    const hex = normalizeHex(raw);
    if (!hex || !PALETTE_HEX.includes(hex)) return { error: `${team}: pick one of the ten colours offered.` };
    const other = seen.get(hex);
    if (other) return { error: `${paletteName(hex)} is already ${other}'s colour. Two teams cannot share one.` };
    seen.set(hex, team); out[team] = hex;
  }
  return { value: out };
}

/* ------------------------------------------------------------------ photos */

/** A person's own photo: the app makes a 160px JPEG well under this; the server holds every upload to it. */
export const PHOTO_MAX_BYTES = 40 * 1024;
export const PHOTO_SIZE = 160;
const PHOTO_URL = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAGIC = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47] } as const;

/** Validates an uploaded photo: a base64 data URL of a JPEG or PNG, no larger than 40 KB, whose bytes really are that format. */
export function checkPhoto(v: unknown): { value: string } | { error: string } {
  if (typeof v !== "string" || v.length > Math.ceil(PHOTO_MAX_BYTES / 3) * 4 + 40) return { error: "That photo is too large. It must be under 40 KB." };
  const m = PHOTO_URL.exec(v);
  if (!m) return { error: "Use a JPEG or PNG image." };
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch { return { error: "That photo could not be read." }; }
  if (bytes.length > PHOTO_MAX_BYTES) return { error: "That photo is too large. It must be under 40 KB." };
  if (!MAGIC[m[1] as "jpeg" | "png"].every((b, i) => bytes[i] === b)) return { error: "That file is not the image type it says it is." };
  return { value: v };
}

/** Which photo an avatar shows: the person's uploaded photo, then an explicit one (their Google picture in the rail), the sample team's, their Google picture matched by name. Initials when none. */
export function pickPhoto(name: string, o: { uploaded?: Record<string, string> | null; src?: string | null; sample?: Record<string, string>; me?: { name: string; picture?: string | null } | null }): string | undefined {
  const own = (m: Record<string, string> | null | undefined) => (m && Object.hasOwn(m, name) ? m[name] : undefined);
  return own(o.uploaded) ?? o.src ?? own(o.sample) ?? (o.me?.picture && o.me.name === name ? o.me.picture : undefined) ?? undefined;
}

/* ----------------------------------------------------------------- the API */

export const SETTING_KEYS = ["accent", "team_colors", "team_glyphs"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export interface Settings { accent: string; team_colors: Record<string, string>; team_glyphs: Record<string, string | null> }

/** Validates one setting write. */
export function checkSetting(key: string, value: unknown): { value: unknown } | { error: string } {
  if (key === "accent") {
    const err = accentError(value);
    return err ? { error: err } : { value: normalizeHex(value) };
  }
  if (key === "team_colors") return checkTeamColors(value);
  if (key === "team_glyphs") return checkTeamGlyphs(value);
  return { error: "No such setting." };
}

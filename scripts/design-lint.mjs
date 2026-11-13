/* Design lint: fails on the UI patterns Bryan has banned by name ("Banned: the AI tells" in BRYAN-DESIGN-INSTRUMENT.md, T4).
   Plain Node, no dependencies, identical in every Desk repo.

   Rules
     pill            a status, date, count, badge, chip, tag or pill class with a fully rounded corner and a background or tint
     dot             a round coloured shape by geometry, whatever its class: 12px or less each way, border-radius 50% or more, a background colour
     pill-radius     any element with border-radius 999px or more (avatars, logos, toggles, switches, progress and track bars, and real action buttons excepted:
                     a btn or button class, or a filled element 28px or taller)
     idle-motion     an animation named or used on pulse, blink or breath
     warm-warning    amber, orange or brown text or background (hue 20 to 50, saturation over 40%) on late, over, overdue, warn, warning, due or alert
     text-link-cta   an anchor or link styled as a link whose text starts "Open", "Undo", "Source thread", "System", "See all", "View all", "View more", "Show all", "Go to", "Learn more"
     state-colour    a coloured (saturation over 20%) text or background on a silent, stale, declined, decline, retired or live class: state is weight and ink, never colour
     status-glyph    a <Mark> component or a mark, glyph or status-icon class in markup: a shape written before a status word
     underlined-action  a link, btn or button rule that underlines its text at rest (hover underlines excepted)
     explainer       a sub, hint, caption or note element (or a sub= prop) whose text is a sentence of five words or more
     type-sizes      a stylesheet that uses more than four distinct font sizes (avatar initials excepted)
     literal-colour  a hex colour written into a rule of a stylesheet instead of a token: every colour is a custom property defined in a :root
                     block, so the accent (a per-install setting) and the rest can change in one place. rgba() shadows and tints are not counted
     motion-transition  a rule that transitions transform, translate, scale, rotate or all, in a sheet with no prefers-reduced-motion rule that narrows transition-property (T17)
     motion-animation   a rule that runs a keyframes animation that moves (transform, translate, scale, rotate) with no prefers-reduced-motion rule for the same selector
     motion-press       a :hover, :active, [data-press] or [data-lift] rule that scales or moves, with no prefers-reduced-motion rule for the same selector
     motion-waapi       a .animate() call on transform, translate or scale in a script that never checks prefers-reduced-motion
     blur               backdrop-filter or filter: blur with no prefers-reduced-transparency rule for the same selector
     translucent-surface  a position: fixed rule whose background is translucent, with no prefers-reduced-transparency rule that replaces it (a rule for the selector, or a redefined token)
     contrast-tokens    a sheet that defines --line in :root and never redefines it under prefers-contrast: more
     allow-reason    a `design-lint: allow` comment with no reason after it

   Exempt a line with the comment `design-lint: allow <reason>` (CSS or TSX), on the rule or tag, or on the line above it. The reason is required.

   docs/DESIGN-LINT-BASELINE.txt lists the violations that existed when the gate was added (file, rule, snippet; no line numbers, so edits do not break it).
   Only violations not in the baseline fail. Run:
     node scripts/design-lint.mjs                    new violations only (exit 1 if any)
     node scripts/design-lint.mjs --all              every violation with line numbers
     node scripts/design-lint.mjs --write-baseline   rewrite the baseline from today's code (Bryan reviews the diff) */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "docs/DESIGN-LINT-BASELINE.txt");
const SCAN_DIRS = ["web/src", "src/app"];
const SCAN_FILES = ["index.html", "signin.html", "web/index.html"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".claude", ".venv", ".data"]);
const EXTS = new Set([".css", ".tsx", ".ts", ".jsx", ".html"]);
const ALLOW_RE = /design-lint:\s*allow\b(.*)/;

export const MESSAGE =
  "Banned UI pattern (see BRYAN-DESIGN-INSTRUMENT.md, Banned: the AI tells). Fix it, or add `design-lint: allow <reason>` if Bryan approved it.";

// ---------- files ----------
function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(e.name.slice(e.name.lastIndexOf(".")))) out.push(p);
  }
}
function sourceFiles() {
  const out = [];
  for (const d of SCAN_DIRS) if (existsSync(join(ROOT, d))) walk(join(ROOT, d), out);
  for (const f of SCAN_FILES) if (existsSync(join(ROOT, f))) out.push(join(ROOT, f));
  return out.sort();
}

// ---------- helpers ----------
const blank = (s) => s.replace(/[^\n]/g, " ");
const lineAt = (text, idx) => text.slice(0, idx).split("\n").length;
const squash = (s, n = 140) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "..." : t; };

function allowedLines(raw, out, file) {
  const ok = new Set(), above = new Set();
  raw.split("\n").forEach((l, i) => {
    const m = l.match(ALLOW_RE);
    if (!m) return;
    if (!m[1].replace(/\*\/|-->|\*\/\}|\}/g, "").trim()) out.push({ file, line: i + 1, rule: "allow-reason", snippet: squash(l) });
    else { ok.add(i + 1); if (/^\s*(\/\*|\/\/|\{\s*\/\*|<!--)/.test(l)) above.add(i + 1); }
  });
  return { ok, above };
}
// Allowed by a comment on any line of the rule or tag, or by a comment on its own line just above it.
const isAllowed = (ok, from, to) => { if (ok.above.has(from - 1)) return true; for (let l = from; l <= to; l++) if (ok.ok.has(l)) return true; return false; };

function words(selector) {
  return new Set(selector.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

// ---------- colour ----------
const NAMED_WARM = new Set(["orange", "darkorange", "chocolate", "sienna", "saddlebrown", "peru", "sandybrown", "brown", "burlywood", "tan", "goldenrod", "darkgoldenrod", "coral"]);
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: s * 100 };
}
const isWarm = ({ h, s }) => h >= 20 && h <= 50 && s > 40;
function literalColors(v) {
  const found = [];
  for (const m of v.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi)) {
    let x = m[1]; if (x.length <= 4) x = [...x].map((c) => c + c).join("");
    found.push(hsl(parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)));
  }
  for (const m of v.matchAll(/rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)/gi)) found.push(hsl(+m[1], +m[2], +m[3]));
  for (const m of v.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%/gi)) found.push({ h: ((+m[1] % 360) + 360) % 360, s: +m[2] });
  for (const m of v.toLowerCase().matchAll(/(?<![\w-])([a-z]+)(?![\w-(])/g)) if (NAMED_WARM.has(m[1])) found.push({ h: 30, s: 100, named: m[1] });
  return found;
}
function resolveColors(v, vars, depth = 0) {
  if (depth > 6) return [];
  const out = literalColors(v.replace(/var\([^)]*\)/g, " "));
  for (const m of v.matchAll(/var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g)) {
    const defs = vars.get(m[1]);
    if (defs) for (const d of defs) out.push(...resolveColors(d, vars, depth + 1));
    else if (m[2]) out.push(...resolveColors(m[2], vars, depth + 1));
  }
  return out;
}

// ---------- CSS ----------
function parseCss(text) {
  // Returns leaf blocks: { selector, line, endLine, decls: Map(prop -> value) } and the custom properties.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  const blocks = [], stack = [];
  let buf = "", bufStart = 0, paren = 0;
  const addDecl = (frame, s) => {
    const i = s.indexOf(":");
    if (i < 0 || !frame) return;
    frame.decls.set(s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim());
  };
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "(") paren++; else if (c === ")") paren = Math.max(0, paren - 1);
    if (paren === 0 && c === "{") {
      const lead = buf.length - buf.trimStart().length;
      stack.push({ selector: buf.trim(), start: bufStart + lead, decls: new Map(), at: buf.trim().startsWith("@") });
      buf = ""; bufStart = i + 1;
    } else if (paren === 0 && c === "}") {
      if (buf.trim()) addDecl(stack[stack.length - 1], buf);
      const f = stack.pop();
      if (f && !f.at && f.decls.size) {
        const parents = stack.filter((p) => !p.at).map((p) => p.selector);
        blocks.push({ selector: [...parents, f.selector].join(" "), line: lineAt(clean, f.start), endLine: lineAt(clean, i), decls: f.decls });
      }
      buf = ""; bufStart = i + 1;
    } else if (paren === 0 && c === ";") {
      if (stack.length && buf.trim()) addDecl(stack[stack.length - 1], buf);
      buf = ""; bufStart = i + 1;
    } else {
      if (!buf.trim()) bufStart = i;
      buf += c;
    }
  }
  return blocks;
}

function cssOf(file, raw) {
  if (!file.endsWith(".html")) return file.endsWith(".css") ? raw : "";
  // Only the <style> contents, everything else blanked so line numbers hold.
  let out = "", last = 0;
  for (const m of raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const s = m.index + m[0].indexOf(m[1]);
    out += blank(raw.slice(last, s)) + m[1]; last = s + m[1].length;
  }
  return out + blank(raw.slice(last));
}

const PILL_WORDS = new Set(["status", "statuses", "date", "dates", "count", "counts", "badge", "badges", "chip", "chips", "tag", "tags", "pill", "pills"]);
const PILL_EXEMPT = /avatar|logo|(^|[^a-z])marks?([^a-z]|$)|toggle|switch|radio|checkbox/i;
const DOT_EXEMPT = PILL_EXEMPT;
const RADIUS_EXEMPT = /avatar|logo|toggle|switch|progress|track|fill|(^|[^a-z])bar([^a-z]|$)/i;
// Real action buttons are not pills: Bryan, 2026-11-12, "solid colored buttons, big, they dont look ai".
const BUTTON_RE = /btn|button/i;
const MOTION_RE = /pulse|blink|breath/i;
const STATE_WORDS = new Set(["silent", "stale", "declined", "decline", "retired", "live"]);
const WARM_WORDS = new Set(["late", "over", "overdue", "warn", "warning", "due", "alert"]);
const hasFill = (d) => ["background", "background-color"].some((p) => d.has(p) && !/^(none|transparent|inherit|initial|unset|0 0)$/i.test(d.get(p).trim()));
const px = (v) => {
  const m = v && v.trim().match(/^(-?[\d.]+)(px|rem|em)?$/i);
  return m ? (m[2] && m[2].toLowerCase() !== "px" ? +m[1] * 16 : +m[1]) : null;
};
function radiusOf(d) {
  const v = d.get("border-radius"); if (!v) return null;
  const first = v.split(/[\s/]+/)[0];
  const m = first.match(/^([\d.]+)(%|px|rem|em)?$/i);
  if (!m) return null;
  return m[2] === "%" ? { pct: +m[1] } : { px: m[2] && m[2] !== "px" ? +m[1] * 16 : +m[1] };
}

function lintCss(sheets, vars, allowFor, out, shapes) {
  // Group the rules by exact selector, in load order, so a shape split over two rules
  // (.dot { width; height } then .dot { border-radius }) reads as one, and a later rule (or sheet) overrides an earlier one.
  const groups = new Map();
  for (const { file, raw } of sheets) for (const b of parseCss(cssOf(file, raw))) {
    const ok = allowFor(file);
    const parts = b.selector.split(/,(?![^(]*\))/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    for (const part of parts) {
      const g = groups.get(part) ?? { file, part, line: b.line, decls: new Map(), allowed: false };
      for (const [k, v] of b.decls) g.decls.set(k, v);
      if (isAllowed(ok, b.line, b.endLine)) g.allowed = true;
      groups.set(part, g);
    }
  }
  const all = [...groups.values()];
  const radiusVal = (v) => (v ? v.replace(/var\(\s*(--[\w-]+)[^)]*\)/g, (m, n) => (vars.get(n) ?? [m])[0]) : v);
  for (const g of all) {
    if (g.allowed) continue;
    const { part, decls: d, file } = g;
    if (d.has("border-radius")) d.set("border-radius", radiusVal(d.get("border-radius")));
    const r = radiusOf(d);
    const w = px(d.get("width")), h = px(d.get("height"));
    const ws = words(part);
    // A compound modifier of the same shape (.tdot.t1 { background }) can supply the fill.
    const filled = hasFill(d) || all.some((o) => !o.allowed && o.part.startsWith(part + ".") && hasFill(o.decls));
    // 1. pill
    if (r && filled && [...ws].some((x) => PILL_WORDS.has(x)) && !PILL_EXEMPT.test(part)) {
      const square = w != null && h != null && w === h;
      if ((r.px != null && r.px >= 999) || (r.pct != null && r.pct >= 50 && !square))
        out.push({ file, line: g.line, rule: "pill", snippet: squash(`${part} { border-radius: ${d.get("border-radius")} }`) });
    }
    // 2. dot
    const small = w != null && h != null && w <= 12 && h <= 12 && w > 0 && h > 0;
    const round = r && w != null && h != null && Math.abs(w - h) <= 1 && ((r.pct != null && r.pct >= 50) || (r.px != null && r.px >= w / 2));
    const dotty = true; // by geometry, whatever the class is called
    // A round dot-named shape with no fill in CSS may get its colour inline in the markup (style={{ background }}).
    if (small && round && !filled && /^\.[\w-]+$/.test(part) && !DOT_EXEMPT.test(part)) shapes.set(part.slice(1), { w, file });
    if (small && round && dotty && filled && !DOT_EXEMPT.test(part))
      out.push({ file, line: g.line, rule: "dot", snippet: squash(`${part} { ${w}px by ${h}px; border-radius: ${d.get("border-radius")} }`) });
    // 2b. pill-radius
    if (r && ((r.px != null && r.px >= 999) || (r.pct != null && r.pct >= 999)) && !RADIUS_EXEMPT.test(part) && !BUTTON_RE.test(part) && !((px(d.get("height")) ?? px(d.get("min-height")) ?? 0) >= 28 && filled) && !(small && round))
      out.push({ file, line: g.line, rule: "pill-radius", snippet: squash(`${part} { border-radius: ${d.get("border-radius")} }`) });
    // 2c. idle-motion
    const anim = [d.get("animation"), d.get("animation-name")].filter(Boolean).join(" ");
    if (anim && !/^none\b/.test(anim.trim()) && (MOTION_RE.test(anim) || [...ws].some((x) => MOTION_RE.test(x)) && /infinite/.test(anim)))
      out.push({ file, line: g.line, rule: "idle-motion", snippet: squash(`${part} { animation: ${anim} }`) });
    // 4. state-colour and underlined-action
    if ([...ws].some((x) => STATE_WORDS.has(x))) {
      for (const p of ["color", "background", "background-color"]) {
        if (!d.has(p)) continue;
        if (resolveColors(d.get(p), vars).some((c) => c.s > 20)) { out.push({ file, line: g.line, rule: "state-colour", snippet: squash(`${part} { ${p}: ${d.get(p)} }`) }); break; }
      }
    }
    if (!part.includes(":") && [...ws].some((x) => ["link", "btn", "button"].includes(x)) && /underline/.test(d.get("text-decoration") ?? d.get("text-decoration-line") ?? ""))
      out.push({ file, line: g.line, rule: "underlined-action", snippet: squash(`${part} { text-decoration: ${d.get("text-decoration") ?? d.get("text-decoration-line")} }`) });
    // 3. warm-warning
    if ([...ws].some((x) => WARM_WORDS.has(x))) {
      for (const p of ["color", "background", "background-color"]) {
        if (!d.has(p)) continue;
        if (resolveColors(d.get(p), vars).some(isWarm)) { out.push({ file, line: g.line, rule: "warm-warning", snippet: squash(`${part} { ${p}: ${d.get(p)} }`) }); break; }
      }
    }
  }
}

// ---------- accessibility signals (T17) ----------
// The three signals are answered independently: reduced motion (no movement, opacity and colour stay), reduced transparency
// (translucent becomes solid, no blur), more contrast (a defined border on near-solid surfaces).
const MOVES_RE = /(?<![-\w])(transform|translate|scale|rotate)(?![-\w])/;
const sameSel = (s) => s.replace(/\s+/g, " ").replace(/=\s*(?:"[^"]*"|'[^']*'|[^\]\s]+)/g, "").trim();
function mediaBlocks(clean) {
  // [{ query, body, line }] for each top-level @media, found by balanced braces. The base text has the three signal blocks blanked.
  const blocks = []; let base = "", last = 0;
  for (const m of clean.matchAll(/@media\s*([^{]*)\{/g)) {
    if (m.index < last) continue;
    let depth = 1, i = m.index + m[0].length;
    for (; i < clean.length && depth; i++) { if (clean[i] === "{") depth++; else if (clean[i] === "}") depth--; }
    const body = clean.slice(m.index + m[0].length, i - 1), q = m[1].trim();
    if (!/prefers-(reduced-motion|reduced-transparency|contrast)/.test(q)) continue;
    blocks.push({ query: q, body, line: lineAt(clean, m.index) });
    base += clean.slice(last, m.index) + blank(clean.slice(m.index, i)); last = i;
  }
  return { blocks, base: base + clean.slice(last) };
}
const translucent = (v, vars, depth = 0) => {
  if (!v || depth > 4) return false;
  for (const m of v.matchAll(/rgba?\([^)]*?[,/]\s*([\d.]+)(%?)\s*\)/gi)) if ((m[2] ? +m[1] / 100 : +m[1]) < 0.95) return true;
  if (/color-mix\([^)]*transparent/i.test(v)) return true;
  for (const m of v.matchAll(/var\(\s*(--[\w-]+)/g)) if ((vars.get(m[1]) ?? []).some((d) => translucent(d, vars, depth + 1))) return true;
  return false;
};
function lintSignals(sheets, vars, allowFor, out) {
  for (const { file, raw } of sheets) {
    if (!file.endsWith(".css")) continue;
    const ok = allowFor(file), clean = cssOf(file, raw).replace(/\/\*[\s\S]*?\*\//g, blank);
    const { blocks, base } = mediaBlocks(clean);
    const covers = (query) => {
      const m = new Map(), tokens = new Set();
      for (const b of blocks) if (query.test(b.query)) for (const r of parseCss(b.body)) {
        for (const part of r.selector.split(/,(?![^(]*\))/)) {
          const k = sameSel(part), cur = m.get(k) ?? new Map();
          for (const [p, v] of r.decls) { cur.set(p, v); if (/^(:root|html)$/.test(k) && p.startsWith("--")) tokens.add(p); }
          m.set(k, cur);
        }
      }
      return { m, tokens };
    };
    const motion = covers(/reduced-motion\s*:\s*reduce/), transp = covers(/reduced-transparency\s*:\s*reduce/), contrast = covers(/prefers-contrast\s*:\s*more/);
    const moving = new Set();
    for (const k of clean.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 1, i = k.index + k[0].length; for (; i < clean.length && depth; i++) { if (clean[i] === "{") depth++; else if (clean[i] === "}") depth--; }
      if (MOVES_RE.test(clean.slice(k.index, i))) moving.add(k[1]);
    }
    const universal = [...motion.m].some(([sel, d]) => /(^|,)\s*\*/.test(sel) && d.has("transition-property") && !MOVES_RE.test(d.get("transition-property")) && !/\ball\b/.test(d.get("transition-property")));
    const seen = new Set();
    const report = (b, part, rule, snippet) => { const key2 = rule + part; if (seen.has(key2)) return; seen.add(key2); if (!isAllowed(ok, b.line, b.endLine)) out.push({ file, line: b.line, rule, snippet: squash(snippet) }); };
    for (const b of parseCss(base)) for (const raw2 of b.selector.split(/,(?![^(]*\))/)) {
      const part = raw2.replace(/\s+/g, " ").trim(), k = sameSel(part), d = b.decls;
      const tr = [d.get("transition"), d.get("transition-property")].filter(Boolean).join(" ");
      if (tr && (MOVES_RE.test(tr) || /(^|[\s,])all(?![-\w])/.test(tr)) && !universal && !motion.m.get(k)?.has("transition"))
        report(b, part, "motion-transition", `${part} { transition: ${tr} }`);
      const an = [d.get("animation"), d.get("animation-name")].filter(Boolean).join(" ");
      if (an && [...moving].some((n) => new RegExp(`(^|[\\s,])${n}([\\s,;]|$)`).test(an)) && !(motion.m.get(k)?.has("animation") || motion.m.get(k)?.has("animation-name")))
        report(b, part, "motion-animation", `${part} { animation: ${an} }`);
      for (const p of ["transform", "translate", "scale", "rotate"])
        if (d.has(p) && !/^(none|1|1 1|translate\(0\)|translate\(0,\s*0\))$/.test(d.get(p).trim()) && /:(hover|active)|\[data-(press|lift)/.test(part) && !motion.m.get(k)?.has(p))
          report(b, part, "motion-press", `${part} { ${p}: ${d.get(p)} }`);
      const bl = d.get("backdrop-filter") ?? d.get("-webkit-backdrop-filter") ?? (/blur/.test(d.get("filter") ?? "") ? d.get("filter") : null);
      if (bl && !/^none$/.test(bl.trim()) && !(transp.m.get(k)?.has("backdrop-filter") || transp.m.get(k)?.has("filter")))
        report(b, part, "blur", `${part} { backdrop-filter: ${bl} }`);
      const bg = d.get("background") ?? d.get("background-color");
      if (/^fixed$/.test((d.get("position") ?? "").trim()) && bg && translucent(bg, vars)) {
        const tokens = [...bg.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
        if (!(transp.m.get(k)?.has("background") || transp.m.get(k)?.has("background-color")) && !tokens.some((t) => transp.tokens.has(t)))
          report(b, part, "translucent-surface", `${part} { background: ${bg} }`);
      }
    }
    if (/--line\s*:/.test(base) && !contrast.tokens.has("--line"))
      out.push({ file, line: 1, rule: "contrast-tokens", snippet: "--line is defined but never redefined under prefers-contrast: more" });
  }
}

// WAAPI movement in a script needs a reduced-motion check somewhere in the same file.
function lintWaapi(file, raw, ok, out) {
  if (/prefers-reduced-motion/.test(raw)) return;
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^(\s*)\/\/.*$/gm, blank);
  for (const m of src.matchAll(/\.animate\(\s*\[([^\]]*(?:\][^\]]*)*?)\]\s*,/g)) {
    if (!/(transform|translate|scale)\s*:/.test(m[1])) continue;
    const line = lineAt(src, m.index);
    if (isAllowed(ok, line, line)) continue;
    out.push({ file, line, rule: "motion-waapi", snippet: squash(m[0]) });
  }
}

// ---------- literal colours ----------
// A hex colour belongs in a :root token block. Anywhere else it is a second copy that a change of accent would miss.
function lintLiterals(sheets, allowFor, out) {
  for (const { file, raw } of sheets) {
    if (!file.endsWith(".css")) continue;
    const ok = allowFor(file);
    for (const b of parseCss(cssOf(file, raw))) {
      if (/^(:root|html)\b/.test(b.selector)) continue;
      if (isAllowed(ok, b.line, b.endLine)) continue;
      for (const [k, v] of b.decls) {
        if (k.startsWith("--")) continue;
        const m = v.replace(/url\([^)]*\)/g, " ").match(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i);
        if (m) { out.push({ file, line: b.line, rule: "literal-colour", snippet: squash(`${b.selector} { ${k}: ${v} }`) }); break; }
      }
    }
  }
}

// ---------- type sizes ----------
// Four sizes is the whole scale (T11). Avatar initials sit in a circle and are not type, so selectors naming an avatar are not counted.
const SIZE_EXEMPT = /(^|[^a-z])(av|avatar)([^a-z]|$)/i;
function lintSizes(sheets, out) {
  for (const { file, raw } of sheets) {
    if (!file.endsWith(".css")) continue;
    const sizes = new Map();
    for (const b of parseCss(cssOf(file, raw))) {
      if (SIZE_EXEMPT.test(b.selector)) continue;
      for (const [k, v] of b.decls) {
        if (k !== "font" && k !== "font-size" && !k.startsWith("--t-")) continue;
        const m = k === "font-size" ? v.match(/^([\d.]+)(px|rem)?/) : v.match(/(?:^|\s)([\d.]+)(px|rem)(?:\/|\s|$)/);
        if (!m) continue;
        const n = (m[2] === "rem" ? +m[1] * 16 : +m[1]);
        if (!sizes.has(n)) sizes.set(n, b.line);
      }
    }
    if (sizes.size > 4) {
      const list = [...sizes.keys()].sort((a, b) => a - b);
      out.push({ file, line: Math.max(...sizes.values()), rule: "type-sizes", snippet: `${sizes.size} font sizes (${list.join(", ")}px); the limit is four` });
    }
  }
}

// ---------- TSX / HTML ----------
const CTA = /^(open\b|undo\b|source thread\b|system\b|see all|view all|view more|show all|go to|learn more)/i;
const EXPLAIN_CLASS = /(^|[\s"'`{])(sub|hint|caption|note|explainer|blurb)([\s"'`}]|$)/;
const STATUS_GLYPH_CLASS = /(^|[\s"'`{])(mark|glyph|status-icon|status-glyph)([\s"'`}]|$)/;
const sentence = (t) => t.trim().split(/\s+/).length >= 5 && /[.!?](\s|$)/.test(t.trim());
function lintMarkup(file, raw, ok, out, shapes) {
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^(\s*)\/\/.*$/gm, (m) => blank(m));
  // Dot shapes coloured inline: <span className="tdot" style={{ background: ... }} />
  for (const m of src.matchAll(/<\w+\s[^<>]*?(?:className|class)=["']([^"']*)["'][^<>]*?style=\{\{([^}]*)\}\}/g)) {
    const cls = m[1].split(/\s+/).find((c) => shapes.has(c));
    if (!cls || !/\bbackground(-?[cC]olor)?\s*:/.test(m[2])) continue;
    const line = lineAt(src, m.index);
    if (isAllowed(ok, line, line + m[0].split("\n").length - 1)) continue;
    out.push({ file, line, rule: "dot", snippet: squash(`<... className="${m[1]}" style={{ ${m[2].trim()} }}> (${shapes.get(cls).w}px round)`) });
  }
  // status-glyph: a <Mark> component, or an element given a mark/glyph class
  for (const m of src.matchAll(/<(Mark)(?=[\s/>])|<\w+\s[^<>]*?(?:className|class)=\{?["'`]([^"'`]*)["'`]/g)) {
    const hit = m[1] === "Mark" || (m[2] && STATUS_GLYPH_CLASS.test(m[2]) && /<svg|<span|<i\b/.test(m[0]));
    if (!hit) continue;
    const line = lineAt(src, m.index);
    if (isAllowed(ok, line, line)) continue;
    out.push({ file, line, rule: "status-glyph", snippet: squash(m[0]) });
  }
  // explainer: sub="..." props, and sentences inside sub, hint, caption or note elements
  for (const m of src.matchAll(/\bsub=(?:"([^"]*)"|\{\s*(?:"([^"]*)"|`([^`$]*)`)\s*\})/g)) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    const line = lineAt(src, m.index);
    if (!sentence(text) || isAllowed(ok, line, line)) continue;
    out.push({ file, line, rule: "explainer", snippet: squash(`sub="${text}"`) });
  }
  for (const m of src.matchAll(/<(\w+)\s[^<>]*?(?:className|class)=(?:"([^"]*)"|\{`([^`]*)`\})[^<>]*>/g)) {
    const cls = m[2] ?? m[3] ?? "";
    if (!EXPLAIN_CLASS.test(` ${cls} `)) continue;
    const from = m.index + m[0].length, end = src.indexOf(`</${m[1]}>`, from);
    if (end < 0) continue;
    const body = src.slice(from, end);
    const lits = [...body.matchAll(/"([^"]*)"|`([^`$]*)`/g)].map((x) => x[1] ?? x[2]).concat(body.replace(/\{[^}]*\}/g, " ").split(/[<>]/).filter((x) => x.trim()));
    const text = lits.find(sentence);
    const line = lineAt(src, m.index);
    if (!text || isAllowed(ok, line, line + body.split("\n").length - 1)) continue;
    out.push({ file, line, rule: "explainer", snippet: squash(`<${m[1]} className="${cls}"> ${text}`) });
  }
  for (const m of src.matchAll(/<(a|button|[A-Z]\w*Link|Link)(?=[\s>])/g)) {
    // Opening tag: scan to the closing > outside braces and quotes.
    let i = m.index + m[0].length, depth = 0, q = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === q && src[i - 1] !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth <= 0) break;
    }
    if (src[i - 1] === "/") continue; // self-closing: no text
    const open = src.slice(m.index, i + 1);
    const cls = open.match(/\b(?:className|class)\s*=\s*(\{[^]*?\}(?=\s|\/?>)|"[^"]*"|'[^']*')/);
    if (!cls || !/link/i.test(cls[1])) continue;
    const end = src.indexOf("</", i);
    let body = src.slice(i + 1, end < 0 ? i + 400 : end);
    body = body.replace(/\{\s*" "\s*\}/g, " ").replace(/^(\s*<[A-Z]\w*[^>]*\/>)+/, "").trim();
    const lit = body.match(/^\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\}/);
    const text = (lit ? lit[1] ?? lit[2] ?? lit[3] : body.split(/[<{]/)[0]).trim();
    if (!CTA.test(text)) continue;
    const line = lineAt(src, m.index), endLine = lineAt(src, i);
    if (isAllowed(ok, line, endLine)) continue;
    out.push({ file, line, rule: "text-link-cta", snippet: squash(`<${m[1]} ${cls[0]}> ${text}`) });
  }
}

// ---------- run ----------
// CSS load order: the order of `import "./x.css"` in the entry file, so a later sheet overrides an earlier one.
function loadOrder(files) {
  const order = [];
  for (const { rel, raw } of files) if (/(^|\/)main\.[tj]sx?$/.test(rel))
    for (const m of raw.matchAll(/import\s+["']\.\/([^"']+\.css)["']/g)) order.push(m[1]);
  const css = files.filter((x) => x.f.endsWith(".css") || x.f.endsWith(".html"));
  const rank = (x) => { const i = order.findIndex((o) => x.rel.endsWith(o)); return i < 0 ? -1 : i; };
  return css.sort((a, b) => rank(a) - rank(b) || a.rel.localeCompare(b.rel));
}

export function lintFiles(files) {
  const out = [], allow = new Map();
  for (const { rel, raw } of files) allow.set(rel, allowedLines(raw, out, rel));
  const sheets = loadOrder(files).map((x) => ({ file: x.rel, raw: x.raw }));
  // Custom properties: every definition in a sheet counts, but a later sheet that redefines a name replaces the earlier sheet's.
  const vars = new Map(), owner = new Map();
  for (const { file, raw } of sheets)
    for (const b of parseCss(cssOf(file, raw))) for (const [k, v] of b.decls) if (k.startsWith("--")) {
      if (owner.get(k) !== file) { vars.set(k, []); owner.set(k, file); }
      vars.get(k).push(v);
    }
  const shapes = new Map();
  lintCss(sheets, vars, (file) => allow.get(file), out, shapes);
  lintSizes(sheets, out);
  lintLiterals(sheets, (file) => allow.get(file), out);
  lintSignals(sheets, vars, (file) => allow.get(file), out);
  for (const { f, rel, raw } of files) if (!f.endsWith(".css")) { lintMarkup(rel, raw, allow.get(rel), out, shapes); if (/\.(tsx?|jsx?)$/.test(rel)) lintWaapi(rel, raw, allow.get(rel), out); }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
}

export function violations() {
  return lintFiles(sourceFiles().map((f) => ({ f, rel: relative(ROOT, f), raw: readFileSync(f, "utf8") })));
}

const key = (v) => `${v.file}\t${v.rule}\t${v.snippet}`;
export const show = (v) => `${v.file}:${v.line}\t${v.rule}\t${v.snippet}`;

export function newViolations() {
  const budget = new Map();
  if (existsSync(BASELINE))
    for (const l of readFileSync(BASELINE, "utf8").split("\n")) {
      if (!l.trim() || l.startsWith("#")) continue;
      budget.set(l, (budget.get(l) ?? 0) + 1);
    }
  return violations().filter((v) => {
    const n = budget.get(key(v)) ?? 0;
    if (n > 0) { budget.set(key(v), n - 1); return false; }
    return true;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2];
  if (arg === "--write-baseline") {
    const all = violations();
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, all.map(key).sort().join("\n") + (all.length ? "\n" : ""));
    console.log(`${all.length} violations written to docs/DESIGN-LINT-BASELINE.txt`);
  } else if (arg === "--all") {
    const all = violations();
    for (const v of all) console.log(show(v));
    console.error(`${all.length} violations in total`);
  } else {
    const fresh = newViolations();
    for (const v of fresh) console.log(show(v));
    if (fresh.length) { console.error(`\n${fresh.length} new. ${MESSAGE}`); process.exit(1); }
  }
}

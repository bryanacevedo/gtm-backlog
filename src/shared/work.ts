/* Work links: the repo, branch, pull requests and Claude sessions behind a build. Pasted as one URL; the kind and
   title are read from the address. Pure functions, no I/O. */

export const LINK_KINDS = ["repo", "pr", "session", "commit", "doc"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_STATES = ["open", "merged", "closed"] as const;
export type LinkState = (typeof LINK_STATES)[number];

export interface WorkLink {
  id: string;
  item_id: string;
  kind: LinkKind;
  url: string;
  title: string;
  state: LinkState | null;
  /** repo, branch, number, sha, draft, date (the day a PR was opened, merged or closed) */
  meta: Record<string, unknown>;
  created_at: string;
  created_by: string;
}

export interface ParsedLink { kind: LinkKind; url: string; title: string; meta: Record<string, unknown> }

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const KIND_WORD: Record<LinkKind, string> = { repo: "repository", pr: "pull request", session: "Claude session", commit: "commit", doc: "link" };
export const kindWord = (k: LinkKind) => KIND_WORD[k];

/** Reads a pasted address. `error` says what is wrong in words. */
export function parseWorkLink(raw: unknown): ParsedLink | { error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { error: "Paste a link." };
  let u: URL;
  try { u = new URL(text); } catch { return { error: "That is not a link. Paste the full address, starting with https://." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "The link must start with http:// or https://." };
  if (text.length > 500) return { error: "That link is too long." };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const seg = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));

  if (host === "github.com" && seg.length >= 2 && NAME.test(seg[0]) && NAME.test(seg[1])) {
    const [owner, name] = seg, repo = `${owner}/${name.replace(/\.git$/, "")}`, base = `https://github.com/${repo}`;
    if (seg[2] === "pull" && /^\d+$/.test(seg[3] ?? "")) {
      const number = Number(seg[3]);
      return { kind: "pr", url: `${base}/pull/${number}`, title: `${repo}#${number}`, meta: { repo, number } };
    }
    if (seg[2] === "commit" && /^[0-9a-f]{7,40}$/i.test(seg[3] ?? "")) {
      const sha = seg[3].toLowerCase();
      return { kind: "commit", url: `${base}/commit/${sha}`, title: `${name}@${sha.slice(0, 7)}`, meta: { repo, sha } };
    }
    if (seg.length === 2) return { kind: "repo", url: base, title: repo, meta: { repo } };
    if (seg[2] === "tree" && seg.length >= 4) {
      const branch = seg.slice(3).join("/");
      return { kind: "repo", url: `${base}/tree/${seg.slice(3).map(encodeURIComponent).join("/")}`, title: repo, meta: { repo, branch } };
    }
  }

  if (host === "claude.ai") {
    const m = u.pathname.match(/^\/(?:code|chat|share|code\/session)\/([\w-]{6,})/);
    if (m) return { kind: "session", url: `https://claude.ai${u.pathname}`, title: "Claude session", meta: { session: m[1] } };
  }

  const path = u.pathname.replace(/\/$/, "");
  return { kind: "doc", url: u.toString(), title: host + (path.length > 1 ? path : ""), meta: {} };
}

/** What a pull request's state reads as: a plain word. Draft is an open PR marked as a draft. */
export function stateWord(l: Pick<WorkLink, "state" | "meta">): string {
  if (!l.state) return "";
  if (l.state === "open" && l.meta.draft === true) return "Draft";
  return l.state[0].toUpperCase() + l.state.slice(1);
}

/** The day a link is dated by: the PR's own date when it has one, else the day it was added. */
export const linkDate = (l: Pick<WorkLink, "meta" | "created_at">) => (typeof l.meta.date === "string" ? l.meta.date : l.created_at.slice(0, 10));

/** What the public GitHub API returns for a pull request, reduced to what the row shows. Null when it is not usable. */
export function readPullRequest(api: unknown): { title: string; state: LinkState; meta: Record<string, unknown> } | null {
  if (!api || typeof api !== "object") return null;
  const a = api as { title?: unknown; state?: unknown; draft?: unknown; merged_at?: unknown; closed_at?: unknown; created_at?: unknown; head?: { ref?: unknown } };
  if (typeof a.title !== "string" || !a.title.trim()) return null;
  const state: LinkState = a.merged_at ? "merged" : a.state === "closed" ? "closed" : "open";
  const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : undefined);
  const date = state === "merged" ? day(a.merged_at) : state === "closed" ? day(a.closed_at) : day(a.created_at);
  const meta: Record<string, unknown> = { draft: a.draft === true };
  if (typeof a.head?.ref === "string") meta.branch = a.head.ref;
  if (date) meta.date = date;
  return { title: a.title.trim().slice(0, 200), state, meta };
}

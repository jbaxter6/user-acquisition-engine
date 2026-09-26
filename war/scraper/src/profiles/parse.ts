// Shared text parsing for profile reads. Pure functions — no browser — so
// they're unit-tested directly (see *.test.ts).

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// "1,257" -> 1257, "12.5K" -> 12500, "163M" -> 163000000. Null if there's no
// number to read (so "unknown" never masquerades as 0).
export function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").trim().match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

// @handles written in a bio. Skips the "@domain" half of email addresses.
export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[^\w.@])@([A-Za-z0-9._]{1,30})/g)) {
    const handle = m[2].replace(/\.+$/, "");
    if (handle) out.add(handle);
  }
  return [...out];
}

export function extractEmail(text: string): string {
  return text.match(EMAIL_RE)?.[0] ?? "";
}

// Everything we read off a profile's header. Numbers are null when the
// page didn't show them (e.g. Instagram's logged-out header has no post
// count) — never 0.
export interface ProfileDetails {
  displayName: string;
  bio: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
  likes: number | null;
  verified: boolean;
  isPrivate: boolean;
  category: string;
  pronouns: string;
  links: string[];
  moreLinks: number;
  mentions: string[];
  highlights: string[];
  email: string;
}

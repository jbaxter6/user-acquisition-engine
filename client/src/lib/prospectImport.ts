import type { Platform } from "../types";
import { parseCount } from "./formatCount";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

// Dynamically imported so `xlsx` (a genuinely large library) only loads
// when someone actually opens the Prospecting import flow, instead of
// bloating every session's initial bundle — it roughly tripled the main
// chunk size when statically imported.
export async function parseSpreadsheet(data: ArrayBuffer): Promise<ParsedSheet> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

export type ProspectField = "username" | "platform" | "displayName" | "followers" | "notes" | "email";

const FIELD_LABELS: Record<ProspectField, string> = {
  username: "Username (required)",
  platform: "Platform",
  displayName: "Display name",
  followers: "Followers",
  notes: "Notes",
  email: "Email",
};

export const PROSPECT_FIELDS: ProspectField[] = [
  "username",
  "platform",
  "displayName",
  "followers",
  "notes",
  "email",
];
export { FIELD_LABELS };

// ---- Profile data columns (what the scraper writes; see war/scraper) ----
// Each maps onto an attribute registry key (server/src/profiles/attributes.ts).
// The server re-validates every value and drops any that don't fit the
// attribute or the row's platform, so a TikTok-only column on an Instagram
// row is harmless.

export type AttributeField =
  | "following"
  | "posts"
  | "likes"
  | "verified"
  | "private"
  | "category"
  | "pronouns"
  | "links"
  | "mentions"
  | "highlights";

type ValueKind = "count" | "boolean" | "text" | "list";

const ATTRIBUTE_FIELD_DEFS: Record<
  AttributeField,
  { key: string; label: string; kind: ValueKind; match: RegExp }
> = {
  following: { key: "following", label: "Following", kind: "count", match: /^(following|following[_ ]?count)$/i },
  posts: { key: "post_count", label: "Posts", kind: "count", match: /^(posts|post[_ ]?count|media[_ ]?count|videos)$/i },
  likes: { key: "likes_total", label: "Total likes (TikTok)", kind: "count", match: /^(likes|total[_ ]?likes|hearts)$/i },
  verified: { key: "verified", label: "Verified", kind: "boolean", match: /^(verified|is[_ ]?verified)$/i },
  private: { key: "is_private", label: "Private account", kind: "boolean", match: /^(private|is[_ ]?private)$/i },
  category: { key: "primary_category", label: "Category", kind: "list", match: /^(category|category[_ ]?label)$/i },
  pronouns: { key: "pronouns", label: "Pronouns", kind: "text", match: /^pronouns$/i },
  links: { key: "links", label: "Links", kind: "list", match: /^(links?|website|link[_ ]?in[_ ]?bio)$/i },
  mentions: { key: "mentions", label: "Mentions", kind: "list", match: /^(mentions|mentioned)$/i },
  highlights: { key: "highlights", label: "Highlights", kind: "list", match: /^highlights$/i },
};

export const ATTRIBUTE_FIELDS = Object.keys(ATTRIBUTE_FIELD_DEFS) as AttributeField[];

export const ATTRIBUTE_FIELD_LABELS = Object.fromEntries(
  ATTRIBUTE_FIELDS.map((f) => [f, ATTRIBUTE_FIELD_DEFS[f].label]),
) as Record<AttributeField, string>;

export type ImportMapping = Partial<Record<ProspectField | AttributeField, string>>;

// Blank cells return undefined (unknown), never 0 / false.
function readCell(kind: ValueKind, raw: unknown, field: AttributeField): unknown {
  if (raw == null) return undefined;
  if (kind === "count") {
    if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
    const s = String(raw).trim();
    return s ? parseCount(s) ?? undefined : undefined;
  }
  const s = String(raw).trim();
  if (!s) return undefined;
  if (kind === "boolean") {
    if (/^(yes|y|true|1)$/i.test(s)) return true;
    if (/^(no|n|false|0)$/i.test(s)) return false;
    return undefined;
  }
  if (kind === "text") return s;
  const items = s
    .split(",")
    .map((v) => v.trim())
    .map((v) => (field === "mentions" ? v.replace(/^@/, "") : v))
    .filter(Boolean);
  return items.length ? items : undefined;
}

const AUTO_MATCH: Record<ProspectField, RegExp> = {
  username: /^(username|handle|ig[_ ]?handle|instagram|account)$/i,
  platform: /^(platform|network|social|site|source[_ ]?platform)$/i,
  displayName: /^(name|display[_ ]?name|full[_ ]?name)$/i,
  followers: /^(followers|follower[_ ]?count)$/i,
  notes: /^(notes|bio|niche|description)$/i,
  email: /^(email|e-?mail)$/i,
};

export function autoMapColumns(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  for (const field of PROSPECT_FIELDS) {
    const match = headers.find((h) => AUTO_MATCH[field].test(h.trim()));
    if (match) mapping[field] = match;
  }
  for (const field of ATTRIBUTE_FIELDS) {
    const match = headers.find((h) => ATTRIBUTE_FIELD_DEFS[field].match.test(h.trim()));
    if (match) mapping[field] = match;
  }
  return mapping;
}

const PLATFORM_VALUES: Record<string, Platform> = {
  instagram: "instagram",
  ig: "instagram",
  insta: "instagram",
  tiktok: "tiktok",
  tt: "tiktok",
  twitch: "twitch",
  ttv: "twitch",
  youtube: "youtube",
  yt: "youtube",
};

export function normalizePlatform(value: unknown, fallback: Platform): Platform {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  return PLATFORM_VALUES[key] ?? fallback;
}

export interface MappedProspect {
  username: string;
  platform: Platform;
  displayName?: string;
  followers?: number;
  notes?: string;
  email?: string;
  attributes?: Record<string, unknown>;
}

// One row per creator with a column per social — the same layout the
// recruits sheets (war/recruits) come in.
const TEMPLATE_HEADERS = ["Instagram", "TikTok", "YouTube", "Twitch", "Email"];
const TEMPLATE_EXAMPLE_ROW = [
  "https://instagram.com/ratemytrack_dj",
  "https://www.tiktok.com/@ratemytrack_dj",
  "",
  "",
  "",
];

// ---- "One row per creator" layout (Instagram / TikTok / ... URL columns) ----

export interface WideLayout {
  instagram?: string;
  tiktok?: string;
  twitch?: string;
  youtube?: string;
  email?: string;
}

const WIDE_HEADERS: Record<keyof WideLayout, RegExp> = {
  instagram: /^(instagram|ig)$/i,
  tiktok: /^tik-?tok$/i,
  twitch: /^twitch$/i,
  youtube: /^you-?tube$/i,
  email: /^e-?mail$/i,
};

/** Returns the column layout if the sheet has per-platform social columns, else null. */
export function detectWideLayout(headers: string[]): WideLayout | null {
  const layout: WideLayout = {};
  for (const key of Object.keys(WIDE_HEADERS) as (keyof WideLayout)[]) {
    const match = headers.find((h) => WIDE_HEADERS[key].test(h.trim()));
    if (match) layout[key] = match;
  }
  const hasSocial = layout.instagram || layout.tiktok || layout.twitch || layout.youtube;
  return hasSocial ? layout : null;
}

const RESERVED_PATHS = new Set([
  "p", "reel", "reels", "explore", "stories", "accounts", "video", "channel", "tv", "share", "t", "user",
]);
const SOCIAL_HOST = /(instagram\.com|tiktok\.com|twitch\.tv|youtube\.com|youtu\.be)/i;

/** Pulls the handle out of a profile URL (or a bare @handle). Empty string if there isn't one. */
export function handleFromUrl(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!SOCIAL_HOST.test(value)) {
    // A bare @handle is fine; any other URL/path isn't a social profile.
    return /[/:]/.test(value) ? "" : value.replace(/^@/, "").split(/[?#\s]/)[0];
  }
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const parts = url.pathname.split("/").filter(Boolean);
    // YouTube: /@handle, /channel/<id>, /c/<name>, /user/<name>
    const isYouTube = /youtube\.com|youtu\.be/i.test(url.hostname);
    const first = (isYouTube && /^(channel|c|user)$/i.test(parts[0] ?? "") ? parts[1] : parts[0]) ?? "";
    const handle = decodeURIComponent(first).replace(/^@/, "");
    return handle && !RESERVED_PATHS.has(handle.toLowerCase()) ? handle : "";
  } catch {
    return "";
  }
}

export interface WideExpansion {
  prospects: MappedProspect[];
  creators: number;
  byPlatform: Record<Platform, number>;
}

/** Turns one-row-per-creator into one prospect per platform link. */
export function expandWideRows(rows: Record<string, unknown>[], layout: WideLayout): WideExpansion {
  const prospects: MappedProspect[] = [];
  const byPlatform: Record<Platform, number> = { instagram: 0, tiktok: 0, twitch: 0, youtube: 0 };
  let creators = 0;
  const cell = (row: Record<string, unknown>, col?: string) =>
    col ? String(row[col] ?? "").trim() : "";

  rows.forEach((row) => {
    const email = cell(row, layout.email);

    let found = 0;
    for (const platform of ["instagram", "tiktok", "twitch", "youtube"] as const) {
      const username = handleFromUrl(cell(row, layout[platform]));
      if (!username) continue;
      found++;
      byPlatform[platform]++;
      prospects.push({
        username,
        platform,
        email: email || undefined,
      });
    }
    if (found > 0) creators++;
  });

  return { prospects, creators, byPlatform };
}

/** Generates and downloads a starter .xlsx with the recognized column headers, so people don't have to guess them. */
export async function downloadProspectTemplate(): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_EXAMPLE_ROW]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Prospects");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "prospect-import-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export function applyMapping(
  rows: Record<string, unknown>[],
  mapping: ImportMapping,
  defaultPlatform: Platform
): MappedProspect[] {
  if (!mapping.username) return [];
  const out: MappedProspect[] = [];
  for (const row of rows) {
    // The username cell may hold a bare handle, an @handle, or a full profile URL.
    const username = handleFromUrl(row[mapping.username]);
    if (!username) continue;
    const followersRaw = mapping.followers ? row[mapping.followers] : undefined;
    const followers = followersRaw != null && followersRaw !== "" ? Number(followersRaw) : undefined;
    out.push({
      username,
      platform: mapping.platform ? normalizePlatform(row[mapping.platform], defaultPlatform) : defaultPlatform,
      displayName: mapping.displayName ? String(row[mapping.displayName] ?? "").trim() || undefined : undefined,
      followers: Number.isFinite(followers) ? followers : undefined,
      notes: mapping.notes ? String(row[mapping.notes] ?? "").trim() || undefined : undefined,
      email: mapping.email ? String(row[mapping.email] ?? "").trim() || undefined : undefined,
      attributes: readAttributes(row, mapping),
    });
  }
  return out;
}

function readAttributes(row: Record<string, unknown>, mapping: ImportMapping): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const field of ATTRIBUTE_FIELDS) {
    const col = mapping[field];
    if (!col) continue;
    const def = ATTRIBUTE_FIELD_DEFS[field];
    const value = readCell(def.kind, row[col], field);
    if (value !== undefined) out[def.key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

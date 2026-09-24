import type { Platform } from "../types";

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

const AUTO_MATCH: Record<ProspectField, RegExp> = {
  username: /^(username|handle|ig[_ ]?handle|instagram|account)$/i,
  platform: /^(platform|network|social|site|source[_ ]?platform)$/i,
  displayName: /^(name|display[_ ]?name|full[_ ]?name)$/i,
  followers: /^(followers|follower[_ ]?count)$/i,
  notes: /^(notes|bio|niche|description)$/i,
  email: /^(email|e-?mail)$/i,
};

export function autoMapColumns(headers: string[]): Partial<Record<ProspectField, string>> {
  const mapping: Partial<Record<ProspectField, string>> = {};
  for (const field of PROSPECT_FIELDS) {
    const match = headers.find((h) => AUTO_MATCH[field].test(h.trim()));
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
  // Rows sharing a group are the same person on different platforms; the
  // server links their cards together.
  group?: string;
}

// One row per creator with a column per social — the same layout the
// recruits sheets (war/recruits) come in.
const TEMPLATE_HEADERS = ["Name", "Profile URL", "Instagram", "TikTok", "YouTube", "Twitch", "Email"];
const TEMPLATE_EXAMPLE_ROW = [
  "DJ Test",
  "https://example.com/djtest",
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
  name?: string;
  profileUrl?: string;
  email?: string;
}

const WIDE_HEADERS: Record<keyof WideLayout, RegExp> = {
  instagram: /^(instagram|ig)$/i,
  tiktok: /^tik-?tok$/i,
  twitch: /^twitch$/i,
  youtube: /^you-?tube$/i,
  name: /^(name|display[_ ]?name|full[_ ]?name)$/i,
  profileUrl: /^profile[_ ]?url$/i,
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
const SOCIAL_HOST = /(instagram\.com|tiktok\.com|twitch\.tv)/i;

/** Pulls the handle out of a profile URL (or a bare @handle). Empty string if there isn't one. */
export function handleFromUrl(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!SOCIAL_HOST.test(value)) return value.replace(/^@/, "").split(/[/?#\s]/)[0];
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
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

/** Turns one-row-per-creator into one prospect per platform, tied together by a shared group. */
export function expandWideRows(rows: Record<string, unknown>[], layout: WideLayout): WideExpansion {
  const prospects: MappedProspect[] = [];
  const byPlatform: Record<Platform, number> = { instagram: 0, tiktok: 0, twitch: 0 };
  let creators = 0;
  const cell = (row: Record<string, unknown>, col?: string) =>
    col ? String(row[col] ?? "").trim() : "";

  rows.forEach((row, index) => {
    const name = cell(row, layout.name);
    const profileUrl = cell(row, layout.profileUrl);
    const email = cell(row, layout.email);
    const youtube = cell(row, layout.youtube);
    // Profile URL is only used to group a creator's rows, not stored.
    const notes = youtube ? `YouTube: ${youtube}` : "";
    const group = profileUrl || name || `row-${index}`;

    let found = 0;
    for (const platform of ["instagram", "tiktok", "twitch"] as const) {
      const username = handleFromUrl(cell(row, layout[platform]));
      if (!username) continue;
      found++;
      byPlatform[platform]++;
      prospects.push({
        username,
        platform,
        displayName: name || undefined,
        notes: notes || undefined,
        email: email || undefined,
        group,
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
  mapping: Partial<Record<ProspectField, string>>,
  defaultPlatform: Platform
): MappedProspect[] {
  if (!mapping.username) return [];
  const out: MappedProspect[] = [];
  for (const row of rows) {
    const username = String(row[mapping.username] ?? "").trim();
    if (!username) continue;
    const followersRaw = mapping.followers ? row[mapping.followers] : undefined;
    const followers = followersRaw != null && followersRaw !== "" ? Number(followersRaw) : undefined;
    out.push({
      username: username.replace(/^@/, ""),
      platform: mapping.platform ? normalizePlatform(row[mapping.platform], defaultPlatform) : defaultPlatform,
      displayName: mapping.displayName ? String(row[mapping.displayName] ?? "").trim() || undefined : undefined,
      followers: Number.isFinite(followers) ? followers : undefined,
      notes: mapping.notes ? String(row[mapping.notes] ?? "").trim() || undefined : undefined,
      email: mapping.email ? String(row[mapping.email] ?? "").trim() || undefined : undefined,
    });
  }
  return out;
}

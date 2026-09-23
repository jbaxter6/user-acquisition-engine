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
}

const TEMPLATE_HEADERS = ["username", "platform", "name", "followers", "notes", "email"];
const TEMPLATE_EXAMPLE_ROW = [
  "ratemytrack_dj",
  "instagram",
  "DJ Test",
  "45000",
  "does rate my track segments",
  "",
];

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

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

export type ProspectField = "username" | "displayName" | "followers" | "notes" | "email";

const FIELD_LABELS: Record<ProspectField, string> = {
  username: "Username (required)",
  displayName: "Display name",
  followers: "Followers",
  notes: "Notes",
  email: "Email",
};

export const PROSPECT_FIELDS: ProspectField[] = ["username", "displayName", "followers", "notes", "email"];
export { FIELD_LABELS };

const AUTO_MATCH: Record<ProspectField, RegExp> = {
  username: /^(username|handle|ig[_ ]?handle|instagram|account)$/i,
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

export interface MappedProspect {
  username: string;
  platform: "instagram";
  displayName?: string;
  followers?: number;
  notes?: string;
  email?: string;
}

export function applyMapping(
  rows: Record<string, unknown>[],
  mapping: Partial<Record<ProspectField, string>>
): MappedProspect[] {
  if (!mapping.username) return [];
  const out: MappedProspect[] = [];
  for (const row of rows) {
    const username = String(row[mapping.username] ?? "").trim();
    if (!username) continue;
    const followersRaw = mapping.followers ? row[mapping.followers] : undefined;
    const followers = followersRaw != null && followersRaw !== "" ? Number(followersRaw) : undefined;
    out.push({
      username,
      platform: "instagram",
      displayName: mapping.displayName ? String(row[mapping.displayName] ?? "").trim() || undefined : undefined,
      followers: Number.isFinite(followers) ? followers : undefined,
      notes: mapping.notes ? String(row[mapping.notes] ?? "").trim() || undefined : undefined,
      email: mapping.email ? String(row[mapping.email] ?? "").trim() || undefined : undefined,
    });
  }
  return out;
}

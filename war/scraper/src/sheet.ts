import * as XLSX from "xlsx";
import { existsSync } from "node:fs";
import type { Prospect } from "./types.js";

// `file`, or `file-2`, `file-3`… if it's taken. Never overwrite an earlier
// run's sheet: its handles are already in seen.json, so they'd be skipped
// from then on and lost for good.
function freePath(file: string): string {
  const base = file.replace(/\.xlsx$/, "");
  let candidate = file;
  for (let n = 2; existsSync(candidate); n++) candidate = `${base}-${n}.xlsx`;
  return candidate;
}

export function writeSheet(target: string, prospects: Prospect[]) {
  const file = freePath(target);
  // Column names match what the app's import auto-maps (client/src/lib/prospectImport.ts).
  // Blank = not shown on that platform's profile; never 0 for unknown.
  const yesNo = (v: boolean | undefined) => (v === undefined ? "" : v ? "Yes" : "No");
  const rows = prospects.map((p) => {
    const d = p.details;
    return {
      Username: p.username,
      Platform: p.platform,
      "Display Name": p.displayName,
      Followers: p.followers,
      Following: d?.following ?? "",
      Posts: d?.posts ?? "",
      Likes: d?.likes ?? "",
      Verified: yesNo(d?.verified),
      Private: yesNo(d?.isPrivate),
      Category: d?.category ?? "",
      Pronouns: d?.pronouns ?? "",
      Bio: d?.bio ?? p.notes,
      Mentions: d?.mentions.map((m) => `@${m}`).join(", ") ?? "",
      Links: d?.links.join(", ") ?? "",
      "More Links": d?.moreLinks || "",
      Highlights: d?.highlights.join(", ") ?? "",
      Email: p.email,
      URL: p.url,
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Prospects");
  XLSX.writeFile(wb, file);
  console.log(`Wrote ${rows.length} prospects to ${file}`);
}

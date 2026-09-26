import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Prospect } from "./types.js";

const SEEN_FILE = "seen.json";
export const key = (platform: string, username: string) => `${platform}:${username.toLowerCase()}`;

// Everyone we should not scrape again: the prod database plus anyone this
// machine has already scraped (they may not be uploaded yet).
export async function loadKnown(): Promise<Set<string>> {
  const known = loadSeen();
  console.log(`Local seen.json: ${known.size} handles`);

  const base = process.env.OUTREACH_URL?.replace(/\/$/, "");
  if (!base) {
    console.log("OUTREACH_URL not set, skipping the check against the prod database.");
    return known;
  }
  try {
    const password = process.env.SITE_PASSWORD ?? "";
    const login = await fetch(`${base}/api/session/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!login.ok) throw new Error(`login failed (${login.status})`);
    const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const res = await fetch(`${base}/api/prospects/handles`, { headers: { Cookie: cookie } });
    if (!res.ok) throw new Error(`handles request failed (${res.status})`);
    const rows = (await res.json()) as { platform: string; username: string }[];
    rows.forEach((r) => known.add(key(r.platform, r.username)));
    console.log(`Prod database: ${rows.length} prospects loaded`);
  } catch (err) {
    console.error(`Could not check prod (${err instanceof Error ? err.message : err}). Continuing with local history only.`);
  }
  return known;
}

// Just this machine's history (seen.json), without the prod check.
export function loadSeen(): Set<string> {
  const seen = new Set<string>();
  if (existsSync(SEEN_FILE)) {
    for (const k of JSON.parse(readFileSync(SEEN_FILE, "utf8")) as string[]) seen.add(k);
  }
  return seen;
}

export function rememberScraped(known: Set<string>, prospects: Prospect[]) {
  prospects.forEach((p) => known.add(key(p.platform, p.username)));
  writeFileSync(SEEN_FILE, JSON.stringify([...known].sort(), null, 1));
}

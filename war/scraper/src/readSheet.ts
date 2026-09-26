import * as XLSX from "xlsx";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { key } from "./known.js";
import type { Platform } from "./types.js";

export interface Account {
  platform: Platform;
  handle: string;
}

const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "twitch"];
const RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "video", "channel", "tv", "share", "t", "user"]);
const SOCIAL_HOST = /(instagram\.com|tiktok\.com|twitch\.tv|youtube\.com|youtu\.be)/i;

// Profile URL (or bare @handle) -> handle; "" if there isn't one. Same rules
// as the app's import (client/src/lib/prospectImport.ts) and fuckem's
// saveProspects, so all three agree on who a link points to.
export function handleFromUrl(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!SOCIAL_HOST.test(value)) {
    return /[/:]/.test(value) ? "" : value.replace(/^@/, "").split(/[?#\s]/)[0];
  }
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const isYouTube = /youtube\.com|youtu\.be/i.test(url.hostname);
    const first = (isYouTube && /^(channel|c|user)$/i.test(parts[0] ?? "") ? parts[1] : parts[0]) ?? "";
    const handle = decodeURIComponent(first).replace(/^@/, "");
    return handle && !RESERVED.has(handle.toLowerCase()) ? handle : "";
  } catch {
    return "";
  }
}

const header = (row: Record<string, unknown>, name: string) =>
  Object.keys(row).find((h) => h.trim().toLowerCase() === name);

/**
 * Every social account in a recruits sheet, deduped, in sheet order. Reads
 * either layout:
 *   - one row per account: `Username` + `Platform` (the scraper's own sheets)
 *   - one row per creator: `Instagram` / `TikTok` / `YouTube` / `Twitch` link
 *     columns (fuckem), falling back to `<Platform> Username` columns
 */
export function readAccounts(file: string): Account[] {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return [];

  const out = new Map<string, Account>();
  const add = (platform: Platform, raw: unknown) => {
    const handle = handleFromUrl(raw);
    if (handle) out.set(key(platform, handle), { platform, handle });
  };

  const usernameCol = header(rows[0], "username");
  const platformCol = header(rows[0], "platform");
  const linkCols = PLATFORMS.map((p) => ({
    platform: p,
    link: header(rows[0], p),
    username: header(rows[0], `${p} username`),
  })).filter((c) => c.link || c.username);

  if (usernameCol && platformCol) {
    for (const row of rows) {
      const platform = String(row[platformCol]).trim().toLowerCase() as Platform;
      if (PLATFORMS.includes(platform)) add(platform, row[usernameCol]);
    }
  } else if (linkCols.length) {
    for (const row of rows) {
      for (const c of linkCols) add(c.platform, (c.link && row[c.link]) || (c.username && row[c.username]));
    }
  } else {
    throw new Error(
      `Couldn't find accounts in ${path.basename(file)}: expected Username + Platform columns, or Instagram/TikTok/YouTube/Twitch link columns.`,
    );
  }
  return [...out.values()];
}

/**
 * Accounts already enriched from this input by an earlier (possibly
 * interrupted) run: rows with a follower count in any `<base>-enriched*.xlsx`
 * next to the output. Lets a rerun pick up where the last one stopped.
 */
export function alreadyEnriched(outDir: string, inputBase: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(outDir)) return done;
  for (const f of readdirSync(outDir)) {
    if (!f.startsWith(`${inputBase}-enriched`) || !f.endsWith(".xlsx")) continue;
    const wb = XLSX.readFile(path.join(outDir, f));
    for (const row of XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])) {
      if (row.Username && row.Platform && row.Followers !== undefined && row.Followers !== "") {
        done.add(key(String(row.Platform), String(row.Username)));
      }
    }
  }
  return done;
}

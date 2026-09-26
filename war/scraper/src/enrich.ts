// Fills in profile data (followers, following, bio, …) for a recruits sheet
// that only has social links — e.g. fuckem's output, which never visits the
// social profiles. See docs/instagram-profile-data.md, "Enriching sheets".
//
//   npm run enrich -- <sheet>.xlsx   (found in ../recruits/intercepts/opp<N>/) [--min N] [--max N] [--refresh]
//
// Writes <sheet>-enriched.xlsx to war/recruits/dossiers/opp<N> (matching
// the intercepts folder it came from; override the base with DOSSIERS_DIR), in the same columns as a search run, so the app's import
// maps it automatically.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { openBrowser } from "./browser.js";
import { saveOnInterrupt } from "./gracefulExit.js";
import { key, loadSeen, rememberScraped } from "./known.js";
import { alreadyEnriched, readAccounts, type Account } from "./readSheet.js";
import { writeSheet } from "./sheet.js";
import { readInstagramProfile, waitForInstagramLogin } from "./sources/instagram.js";
import { readTikTokProfile } from "./sources/tiktok.js";
import type { ProfileDetails } from "./profiles/parse.js";
import type { Prospect } from "./types.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Same pacing as a search run: Instagram gets the slower, more human delay.
const DELAY: Record<string, [number, number]> = { instagram: [6000, 12000], tiktok: [3000, 7000] };
// This many failed reads in a row on one platform almost always means it's
// blocking us (login wall, "try again later"). Stop and save rather than
// hammering it — a rerun later continues from here.
const MAX_CONSECUTIVE_FAILURES = 5;

const PROFILE_URL: Record<Account["platform"], (h: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}/`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  twitch: (h) => `https://twitch.tv/${h}`,
};

// A row with just the account and no stats: YouTube/Twitch (not read yet),
// or an account that couldn't be loaded. Kept so nothing from the input is lost.
function bareRow(a: Account): Prospect {
  return {
    username: a.handle,
    platform: a.platform,
    displayName: "",
    followers: null,
    notes: "",
    email: "",
    url: PROFILE_URL[a.platform](a.handle),
  };
}

function enrichedRow(a: Account, handle: string, d: ProfileDetails): Prospect {
  return {
    username: handle,
    platform: a.platform,
    displayName: d.displayName,
    followers: d.followers,
    notes: d.bio.replace(/\s+/g, " ").slice(0, 500),
    email: d.email,
    url: PROFILE_URL[a.platform](handle),
    details: d,
  };
}

async function readProfile(page: Page, a: Account): Promise<{ handle: string; details: ProfileDetails } | null> {
  if (a.platform === "instagram") {
    const details = await readInstagramProfile(page, a.handle);
    return details && { handle: a.handle, details };
  }
  const details = await readTikTokProfile(page, a.handle);
  return details && { handle: details.handle, details };
}

// A bare file name is looked up in war/recruits/intercepts/<opp folder>,
// where fuckem saves its sheets, so `npm run enrich -- opp1-strat-2-….xlsx`
// works.
const INTERCEPTS_DIR = "../recruits/intercepts";
function findIntercept(name: string): string | undefined {
  if (!existsSync(INTERCEPTS_DIR)) return undefined;
  const dirs = [INTERCEPTS_DIR, ...readdirSync(INTERCEPTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(INTERCEPTS_DIR, d.name))];
  return dirs.map((d) => path.join(d, name)).find((f) => existsSync(f));
}
const arg0 = process.argv[2];
const input = arg0 && !existsSync(arg0) ? (findIntercept(arg0) ?? arg0) : arg0;
if (!input || input.startsWith("--") || !existsSync(input)) {
  console.error("Usage: npm run enrich -- <sheet.xlsx in war/recruits/intercepts/opp<N>, or a path> [--min N] [--max N] [--refresh]");
  process.exit(1);
}
const min = arg("min") ? Number(arg("min")) : null;
const max = arg("max") ? Number(arg("max")) : null;

// Mirror the intercepts layout: a sheet from intercepts/opp1/ goes to
// dossiers/opp1/. Sheets from anywhere else go to dossiers/ itself.
const base = path.basename(input, path.extname(input));
const oppFolder = (() => {
  const parent = path.resolve(input, "..");
  return path.dirname(parent) === path.resolve(INTERCEPTS_DIR) ? path.basename(parent) : "";
})();
const outDir = path.join(process.env.DOSSIERS_DIR ?? "../recruits/dossiers", oppFolder);
mkdirSync(outDir, { recursive: true });
const accounts = readAccounts(input);
const done = process.argv.includes("--refresh") ? new Set<string>() : alreadyEnriched(outDir, base);
const todo = accounts.filter((a) => !done.has(key(a.platform, a.handle)));
const readable = todo.filter((a) => a.platform === "instagram" || a.platform === "tiktok");

const count = (p: string) => todo.filter((a) => a.platform === p).length;
console.log(
  `${accounts.length} accounts in ${path.basename(input)}: ${count("instagram")} Instagram, ${count("tiktok")} TikTok, ` +
    `${count("youtube") + count("twitch")} YouTube/Twitch (kept without stats).`,
);
if (done.size) {
  console.log(
    `Skipping ${accounts.length - todo.length} already enriched by an earlier run (upload those files too, or use --refresh to redo them).`,
  );
}

const seen = loadSeen();
const collected: Prospect[] = [];
const rememberEnriched = () => rememberScraped(seen, collected.filter((p) => p.details));
const release = saveOnInterrupt(() => {
  if (!collected.length) return console.log("Nothing enriched yet, no file written.");
  writeSheet(`${outDir}/${base}-enriched-partial.xlsx`, collected);
  rememberEnriched();
});

const stats = { enriched: 0, failed: 0, bare: 0, outOfRange: 0 };
let finished = false;
try {
  const browser = readable.length ? await openBrowser() : null;
  try {
    if (browser && readable.some((a) => a.platform === "instagram")) await waitForInstagramLogin(browser.page);

    const failuresInARow: Record<string, number> = { instagram: 0, tiktok: 0 };
    let first = true;
    for (const a of todo) {
      if (a.platform !== "instagram" && a.platform !== "tiktok") {
        collected.push(bareRow(a));
        stats.bare++;
        continue;
      }
      if (!first) await sleep(DELAY[a.platform][0] + Math.random() * (DELAY[a.platform][1] - DELAY[a.platform][0]));
      first = false;

      const result = await readProfile(browser!.page, a).catch(() => null);
      if (!result) {
        console.log(`  ${a.platform} @${a.handle}: couldn't read profile, kept without stats`);
        collected.push(bareRow(a));
        stats.failed++;
        if (++failuresInARow[a.platform] >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(
            `${MAX_CONSECUTIVE_FAILURES} ${a.platform} profiles in a row failed to load — it's probably blocking us. ` +
              `Stopping; rerun the same command later to continue.`,
          );
        }
        continue;
      }
      failuresInARow[a.platform] = 0;

      const followers = result.details.followers;
      if (followers != null && ((min != null && followers < min) || (max != null && followers > max))) {
        stats.outOfRange++;
        continue;
      }
      collected.push(enrichedRow(a, result.handle, result.details));
      stats.enriched++;
      console.log(
        `  + ${a.platform} @${result.handle}: ${followers?.toLocaleString() ?? "?"} followers [${stats.enriched}/${readable.length}]`,
      );
    }
    finished = true;
  } finally {
    await browser?.close();
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  release();
}

if (collected.length) {
  writeSheet(`${outDir}/${base}-enriched${finished ? "" : "-partial"}.xlsx`, collected);
  rememberEnriched();
} else {
  console.log("Nothing to write.");
}
console.log(
  `Done: ${stats.enriched} enriched, ${stats.failed} couldn't be read (kept without stats), ` +
    `${stats.bare} YouTube/Twitch kept without stats` +
    (min != null || max != null ? `, ${stats.outOfRange} outside the follower range (dropped)` : "") +
    ".",
);
if (!finished) process.exitCode = 1;

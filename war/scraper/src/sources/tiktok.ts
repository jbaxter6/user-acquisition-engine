import type { Page } from "playwright";
import { openBrowser } from "../browser.js";
import type { Prospect, SourceOptions } from "../types.js";
import type { ProfileDetails } from "../profiles/parse.js";
import { parseTikTok, snapshotTikTok } from "../profiles/tiktok.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const humanDelay = (min = 3000, max = 7000) => sleep(min + Math.random() * (max - min));

// Collect @handles from the user-search results, scrolling to load more.
async function collectHandles(page: Page, tab: "user" | "live", query: string, want: number): Promise<string[]> {
  await page.goto(`https://www.tiktok.com/search/${tab}?q=${encodeURIComponent(query)}`);
  const handles = new Set<string>();
  let idleRounds = 0;
  let warned = false;

  while (handles.size < want && idleRounds < 6) {
    const found = await page.$$eval('a[href^="/@"]', (as) =>
      as.map((a) => (a.getAttribute("href") ?? "").match(/^\/@([\w.]+)(?:\/live)?\/?$/)?.[1]).filter(Boolean) as string[],
    );
    const before = handles.size;
    found.forEach((h) => handles.add(h));

    if (handles.size === before) {
      idleRounds++;
      if (handles.size === 0 && !warned) {
        warned = true;
        console.log("No results yet. If TikTok shows a captcha or login wall, solve it in the browser window (waiting up to 2 min)...");
        idleRounds = -20;
      }
    } else idleRounds = 0;

    await page.mouse.wheel(0, 2500);
    await humanDelay(1500, 3000);
  }
  return [...handles];
}

// Load the profile and read what's on screen (see profiles/tiktok.ts).
export async function readTikTokProfile(page: Page, handle: string): Promise<ProfileDetails & { handle: string } | null> {
  await page.goto(`https://www.tiktok.com/@${handle}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-e2e="user-subtitle"]', { timeout: 10000 }).catch(() => null);
  const snap = await snapshotTikTok(page);
  if (!snap?.subtitle) return null;
  return { ...parseTikTok(snap), handle: snap.subtitle };
}

async function scrape(tab: "user" | "live", opts: SourceOptions): Promise<Prospect[]> {
  const { page, close } = await openBrowser();
  const out: Prospect[] = [];

  try {
    const handles = await collectHandles(page, tab, opts.category, opts.limit * 3);
    console.log(`Found ${handles.length} candidate accounts for "${opts.category}", reading profiles...`);

    for (const handle of handles) {
      if (out.length >= opts.limit) break;
      if (opts.skip?.has(`tiktok:${handle.toLowerCase()}`)) continue;
      await humanDelay();
      const p = await readTikTokProfile(page, handle);
      if (!p) {
        console.log(`  @${handle}: couldn't read profile (blocked or missing), skipping`);
        continue;
      }
      const followers = p.followers ?? 0;
      if (followers < opts.minFollowers || followers > opts.maxFollowers) continue;
      if (opts.keywords.length && !opts.keywords.some((k) => p.bio.toLowerCase().includes(k))) continue;

      out.push({
        username: p.handle,
        platform: "tiktok",
        displayName: p.displayName,
        followers,
        notes: p.bio.replace(/\s+/g, " ").slice(0, 500),
        email: p.email,
        url: `https://www.tiktok.com/@${p.handle}`,
        details: p,
      });
      opts.onProspect?.(out[out.length - 1]);
      console.log(`  + @${p.handle} (${followers.toLocaleString()} followers) [${out.length}/${opts.limit}]`);
    }
  } finally {
    await close();
  }
  return out;
}

export const scrapeTikTok = (opts: SourceOptions) => scrape("user", opts);
// Search's "LIVE" tab: accounts currently streaming for the query.
export const scrapeTikTokLive = (opts: SourceOptions) => scrape("live", opts);

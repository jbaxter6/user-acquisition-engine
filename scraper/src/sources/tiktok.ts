import type { Page } from "playwright";
import { openBrowser } from "../browser.js";
import type { Prospect, SourceOptions } from "../types.js";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
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

interface ProfileData {
  uniqueId: string;
  nickname: string;
  signature: string;
  followers: number;
}

async function readProfile(page: Page, handle: string): Promise<ProfileData | null> {
  await page.goto(`https://www.tiktok.com/@${handle}`, { waitUntil: "domcontentloaded" });
  const raw = await page
    .locator("script#__UNIVERSAL_DATA_FOR_REHYDRATION__")
    .textContent({ timeout: 10000 })
    .catch(() => null);
  if (!raw) return null;
  try {
    const info = JSON.parse(raw)["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.userInfo;
    if (!info?.user) return null;
    return {
      uniqueId: info.user.uniqueId,
      nickname: info.user.nickname ?? "",
      signature: info.user.signature ?? "",
      followers: info.stats?.followerCount ?? 0,
    };
  } catch {
    return null;
  }
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
      const p = await readProfile(page, handle);
      if (!p) {
        console.log(`  @${handle}: couldn't read profile (blocked or missing), skipping`);
        continue;
      }
      if (p.followers < opts.minFollowers || p.followers > opts.maxFollowers) continue;
      if (opts.keywords.length && !opts.keywords.some((k) => p.signature.toLowerCase().includes(k))) continue;

      out.push({
        username: p.uniqueId,
        platform: "tiktok",
        displayName: p.nickname,
        followers: p.followers,
        notes: p.signature.replace(/\s+/g, " ").slice(0, 500),
        email: p.signature.match(EMAIL_RE)?.[0] ?? "",
        url: `https://www.tiktok.com/@${p.uniqueId}`,
      });
      console.log(`  + @${p.uniqueId} (${p.followers.toLocaleString()} followers) [${out.length}/${opts.limit}]`);
    }
  } finally {
    await close();
  }
  return out;
}

export const scrapeTikTok = (opts: SourceOptions) => scrape("user", opts);
// Search's "LIVE" tab: accounts currently streaming for the query.
export const scrapeTikTokLive = (opts: SourceOptions) => scrape("live", opts);

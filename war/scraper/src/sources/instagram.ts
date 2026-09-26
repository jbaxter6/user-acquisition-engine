import type { Page } from "playwright";
import { openBrowser } from "../browser.js";
import type { Prospect, SourceOptions } from "../types.js";
import type { ProfileDetails } from "../profiles/parse.js";
import { parseInstagram, snapshotInstagram } from "../profiles/instagram.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const humanDelay = (min = 6000, max = 12000) => sleep(min + Math.random() * (max - min));

// Visit the profile like a person would and read what's on screen (see
// profiles/instagram.ts). Null if the header never rendered.
export async function readInstagramProfile(page: Page, handle: string): Promise<ProfileDetails | null> {
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 8000 }).catch(() => null);
  const snap = await snapshotInstagram(page);
  if (!snap) return null;
  const details = parseInstagram(snap, handle);
  return details.followers == null ? null : details;
}

// Waits (up to 5 min) for the person to log into Instagram in the browser.
export async function waitForInstagramLogin(page: Page): Promise<void> {
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  const loggedIn = async () =>
    (await page.context().cookies("https://www.instagram.com")).some((c) => c.name === "sessionid");
  if (await loggedIn()) return;
  console.log("Not logged into Instagram. Log in in the browser window (waiting up to 5 min)...");
  const deadline = Date.now() + 300000;
  while (!(await loggedIn())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Instagram login.");
    await sleep(2000);
  }
  await sleep(3000);
}

export async function scrapeInstagram(opts: SourceOptions): Promise<Prospect[]> {
  const { page, close } = await openBrowser();
  const out: Prospect[] = [];

  try {
    await waitForInstagramLogin(page);

    // The keyword page (the reel grid you see under Search) loads its posts as
    // JSON. Listen for those responses and collect each post's author.
    const authors = new Map<string, number>(); // username -> posts seen
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const o = node as Record<string, unknown>;
      for (const key of ["user", "owner"]) {
        const u = o[key] as { username?: unknown } | undefined;
        if (u && typeof u.username === "string" && ("code" in o || "pk" in o || "id" in o)) {
          authors.set(u.username, (authors.get(u.username) ?? 0) + 1);
        }
      }
      Object.values(o).forEach(walk);
    };
    page.on("response", async (res) => {
      const url = res.url();
      if (!/instagram\.com\/(api\/|graphql)/.test(url)) return;
      try {
        walk(await res.json());
      } catch {
        /* not JSON */
      }
    });

    await page.goto(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(opts.category)}`, {
      waitUntil: "domcontentloaded",
    });
    const want = opts.limit * 3;
    let idle = 0;
    while (authors.size < want && idle < 6) {
      const before = authors.size;
      await page.mouse.wheel(0, 3000);
      await sleep(2500 + Math.random() * 1500);
      idle = authors.size === before ? idle + 1 : 0;
    }
    if (authors.size === 0) {
      throw new Error("No posts captured from the keyword page. Check the browser: is it logged in and showing results?");
    }
    const handles = [...authors.keys()];
    console.log(`Found ${handles.length} creators posting about "${opts.category}", reading profiles...`);

    for (const handle of handles) {
      if (out.length >= opts.limit) break;
      if (opts.skip?.has(`instagram:${handle.toLowerCase()}`)) continue;
      await humanDelay();
      const prof = await readInstagramProfile(page, handle);
      if (!prof) {
        console.log(`  @${handle}: couldn't read profile (missing or blocked), skipping`);
        continue;
      }
      const followers = prof.followers ?? 0;
      if (followers < opts.minFollowers || followers > opts.maxFollowers) continue;
      if (opts.keywords.length && !opts.keywords.some((k) => prof.bio.toLowerCase().includes(k))) continue;

      out.push({
        username: handle,
        platform: "instagram",
        displayName: prof.displayName,
        followers,
        notes: prof.bio.replace(/\s+/g, " ").slice(0, 500),
        email: prof.email,
        url: `https://www.instagram.com/${handle}/`,
        details: prof,
      });
      opts.onProspect?.(out[out.length - 1]);
      console.log(`  + @${handle} (${followers.toLocaleString()} followers) [${out.length}/${opts.limit}]`);
    }
  } finally {
    await close();
  }
  return out;
}

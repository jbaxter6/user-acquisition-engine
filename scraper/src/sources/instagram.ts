import type { Page } from "playwright";
import { openBrowser } from "../browser.js";
import type { Prospect, SourceOptions } from "../types.js";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const humanDelay = (min = 6000, max = 12000) => sleep(min + Math.random() * (max - min));

// Instagram's web app calls these JSON endpoints itself; we call them from
// inside the logged-in page so the session cookies apply.
function parseCount(raw: string): number {
  const m = raw.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K"] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

// Visit the profile like a person would and read the public header.
async function readProfile(page: Page, handle: string) {
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
  const meta = await page
    .locator('meta[property="og:description"]')
    .getAttribute("content", { timeout: 8000 })
    .catch(() => null);
  const followersRaw = meta?.match(/([\d.,]+[KMB]?)\s+Followers/i)?.[1];
  if (!followersRaw) return null;
  const fullName = meta?.match(/from (.+?) \(@/)?.[1] ?? "";
  const header = await page.locator("header").first().innerText({ timeout: 3000 }).catch(() => "");
  return { followers: parseCount(followersRaw), bio: header.replace(/\s+/g, " "), fullName };
}

const IG_APP_ID = "936619743392459";

export async function scrapeInstagram(opts: SourceOptions): Promise<Prospect[]> {
  const { page, close } = await openBrowser();
  const out: Prospect[] = [];

  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    const loggedIn = async () =>
      (await page.context().cookies("https://www.instagram.com")).some((c) => c.name === "sessionid");
    if (!(await loggedIn())) {
      console.log("Not logged into Instagram. Log in in the browser window (waiting up to 5 min)...");
      const deadline = Date.now() + 300000;
      while (!(await loggedIn())) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for Instagram login.");
        await sleep(2000);
      }
      await sleep(3000);
    }

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
      await humanDelay();
      const prof = await readProfile(page, handle);
      if (!prof) {
        console.log(`  @${handle}: couldn't read profile (missing or blocked), skipping`);
        continue;
      }
      const { followers, bio, fullName } = prof;
      if (followers < opts.minFollowers || followers > opts.maxFollowers) continue;
      if (opts.keywords.length && !opts.keywords.some((k) => bio.toLowerCase().includes(k))) continue;

      out.push({
        username: handle,
        platform: "instagram",
        displayName: fullName,
        followers,
        notes: bio.replace(/\s+/g, " ").slice(0, 500),
        email: bio.match(EMAIL_RE)?.[0] ?? "",
        url: `https://www.instagram.com/${handle}/`,
      });
      console.log(`  + @${handle} (${followers.toLocaleString()} followers) [${out.length}/${opts.limit}]`);
    }
  } finally {
    await close();
  }
  return out;
}

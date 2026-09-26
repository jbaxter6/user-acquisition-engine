import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { extractEmail, extractMentions, parseCount } from "./parse.js";
import { parseInstagram, snapshotInstagram, type InstagramSnapshot } from "./instagram.js";
import { parseTikTok, snapshotTikTok } from "./tiktok.js";

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");

describe("parseCount", () => {
  it.each([
    ["1,257", 1257],
    ["752", 752],
    ["12.5K", 12500],
    ["163M", 163_000_000],
    ["2.7B", 2_700_000_000],
    ["1.2m", 1_200_000],
  ])("%s -> %d", (raw, n) => expect(parseCount(raw)).toBe(n));

  it("returns null (not 0) when there's nothing to read", () => {
    expect(parseCount(null)).toBeNull();
    expect(parseCount("")).toBeNull();
    expect(parseCount("followers")).toBeNull();
  });
});

describe("extractMentions / extractEmail", () => {
  it("finds @handles but not the domain half of an email", () => {
    const bio = "by @caitlinsmusicspace ✨ bookings: hi@caitlin.com (also @other.acct.)";
    expect(extractMentions(bio)).toEqual(["caitlinsmusicspace", "other.acct"]);
    expect(extractEmail(bio)).toBe("hi@caitlin.com");
  });
});

// Real pages saved 2026-09-25 — these run the actual in-page snapshot code,
// so a selector drift shows up here, not as empty spreadsheet columns.
describe("in-page snapshots against saved pages", () => {
  let browser: Browser | null = null;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => null);
    if (browser) page = await browser.newPage();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("reads an Instagram profile header (logged out)", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(fixture("instagram-profile-logged-out.html"));
    const snap = await snapshotInstagram(page);
    expect(snap).not.toBeNull();
    const d = parseInstagram(snap!, "musicreviewsbycaitlin");
    expect(d).toEqual({
      displayName: "caitlin dyson | melb/naarm",
      bio: "🎸| specialising in australian music: reviews and interviews\nby @caitlinsmusicspace ✨",
      followers: 1257, // header tooltip, not the stale meta (1,256)
      following: 752, // header, not the stale meta (759)
      posts: 270, // logged-out header omits posts, falls back to meta
      likes: null,
      verified: true,
      isPrivate: false,
      category: "", // logged-out view doesn't render the category label
      pronouns: "she/her",
      links: ["linktr.ee/musicreviewsbycaitlin"],
      moreLinks: 1,
      mentions: ["caitlinsmusicspace"],
      highlights: ["shows !!", "interviews !!", "monthly picks", "🥰🥰🥰"],
      email: "",
    });
  });

  it("reads a TikTok profile header", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(fixture("tiktok-profile.html"));
    const snap = await snapshotTikTok(page);
    expect(snap).not.toBeNull();
    const d = parseTikTok(snap!);
    expect(d).toMatchObject({
      displayName: "Khabane lame",
      followers: 163_000_000,
      following: 81,
      likes: 2_700_000_000,
      verified: true,
      isPrivate: false,
      links: [],
    });
    expect(d.bio).toMatch(/^Se vuoi ridere/);
  });

  it("returns null when the page isn't a profile", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent("<html><body><p>Log in to continue</p></body></html>");
    expect(await snapshotInstagram(page)).toBeNull();
    expect(await snapshotTikTok(page)).toBeNull();
  });
});

// The logged-in header adds UI chrome (buttons, "Followed by…") and the
// category label. Modeled on the screenshot in docs — swap for a saved
// logged-in page once one's captured.
describe("parseInstagram with a logged-in header", () => {
  const snap: InstagramSnapshot = {
    textBlocks: [
      "musicreviewsbycaitlin",
      "Verified",
      "Follow",
      "Message",
      "270",
      "posts",
      "1,257",
      "followers",
      "752",
      "following",
      "caitlin dyson | melb/naarm",
      "she/her",
      "Digital creator",
      "🎸| specialising in australian music: reviews and interviews\nby",
      "@caitlinsmusicspace",
      "✨",
      "Link icon",
      "linktr.ee/musicreviewsbycaitlin and 1 more",
      "Followed by someone and 3 others",
    ],
    headerLines: [
      "musicreviewsbycaitlin",
      "Follow",
      "Message",
      "270 posts",
      "1,257 followers",
      "752 following",
      "caitlin dyson | melb/naarm",
      "she/her",
      "Digital creator",
      "🎸| specialising in australian music: reviews and interviews",
      "by @caitlinsmusicspace ✨",
      "linktr.ee/musicreviewsbycaitlin and 1 more",
      "Followed by someone and 3 others",
    ],
    bio: "🎸| specialising in australian music: reviews and interviews\nby @caitlinsmusicspace ✨",
    linkText: "linktr.ee/musicreviewsbycaitlin and 1 more",
    verified: true,
    followersTitle: "1,257",
    highlights: [],
    ogTitle: "caitlin dyson | melb/naarm (@musicreviewsbycaitlin) • Instagram photos and videos",
    metaDescription: null,
    privateNotice: false,
  };

  it("picks the category label out from the chrome around it", () => {
    const d = parseInstagram(snap, "musicreviewsbycaitlin");
    expect(d.category).toBe("Digital creator");
    expect(d.posts).toBe(270);
    expect(d.followers).toBe(1257);
    expect(d.following).toBe(752);
  });

  it("leaves category empty rather than guessing when there isn't one", () => {
    const d = parseInstagram(
      { ...snap, textBlocks: snap.textBlocks.filter((l) => l !== "Digital creator") },
      "musicreviewsbycaitlin",
    );
    expect(d.category).toBe("");
  });

  it("uses rounded header counts when there's no exact tooltip", () => {
    const d = parseInstagram(
      { ...snap, followersTitle: null, headerLines: [...snap.headerLines, "12.5K followers"] },
      "musicreviewsbycaitlin",
    );
    expect(d.followers).toBe(12500);
  });

  it("flags private accounts", () => {
    expect(parseInstagram({ ...snap, privateNotice: true }, "x").isPrivate).toBe(true);
  });
});

describe("parseTikTok", () => {
  it("treats TikTok's 'No bio yet' placeholder as an empty bio", () => {
    const d = parseTikTok({
      title: "a",
      subtitle: "a",
      following: "1",
      followers: "2",
      likes: "3",
      bio: "No bio yet.",
      link: "linktr.ee/a",
      verified: false,
      privateNotice: false,
    });
    expect(d.bio).toBe("");
    expect(d.links).toEqual(["linktr.ee/a"]);
  });
});

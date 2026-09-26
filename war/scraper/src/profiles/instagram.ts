import type { Page } from "playwright";
import { extractEmail, extractMentions, parseCount, type ProfileDetails } from "./parse.js";

// Reads an Instagram profile from what's rendered on screen — no API calls
// (see docs/instagram-profile-data.md). Split in two so the fragile part is
// testable:
//   snapshotInstagram: raw DOM reads inside the page (selectors live here)
//   parseInstagram:    pure interpretation of that snapshot
//
// Selectors key off stable hooks only — aria-labels, roles, title
// attributes, meta tags — never Instagram's obfuscated class names.

export interface InstagramSnapshot {
  // Rendered lines — depends on CSS layout, so only used for the count
  // phrases ("752 following"), which always render whole.
  headerLines: string[];
  // Each element's own text, in document order — layout-independent. Used
  // for name/pronouns/category, which sit in sibling spans that CSS may or
  // may not put on separate lines.
  textBlocks: string[];
  bio: string | null;
  linkText: string | null;
  verified: boolean;
  followersTitle: string | null;
  highlights: string[];
  ogTitle: string | null;
  metaDescription: string | null;
  privateNotice: boolean;
}

// Runs in the browser. No named inner functions: tsx/esbuild would wrap
// them in a __name() helper that doesn't exist inside the page.
export async function snapshotInstagram(page: Page): Promise<InstagramSnapshot | null> {
  return page.evaluate(() => {
    const header = document.querySelector("main header") ?? document.querySelector("header");
    if (!header) return null;
    const bioEl = header.querySelector('div[role="button"] > span[dir="auto"]') as HTMLElement | null;
    const linkBtn = Array.from(header.querySelectorAll("button")).find((b) =>
      b.querySelector('svg[aria-label="Link icon"]'),
    );
    // The follower count's exact value sits in a title tooltip; prefer the
    // one whose link/row says "followers" in case other titled spans appear.
    const titled = Array.from(header.querySelectorAll("span[title]"));
    const followersSpan =
      titled.find((s) => /followers/i.test((s.closest("a, li") as HTMLElement | null)?.innerText ?? "")) ??
      titled[0];
    const textBlocks: string[] = [];
    for (const el of Array.from(header.querySelectorAll("*"))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? "").trim())
        .filter(Boolean)
        .join("\n");
      if (own) textBlocks.push(own);
    }
    return {
      textBlocks,
      headerLines: (header as HTMLElement).innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      bio: bioEl ? bioEl.innerText.trim() : null,
      linkText: linkBtn ? linkBtn.innerText.trim() : null,
      verified: !!header.querySelector('svg[aria-label="Verified"]'),
      followersTitle: followersSpan?.getAttribute("title") ?? null,
      highlights: Array.from(document.querySelectorAll('a[aria-label^="View "][aria-label$=" highlight"]'))
        .map((a) => (a as HTMLElement).innerText.trim())
        .filter(Boolean),
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null,
      metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
      privateNotice: /this account is private/i.test(document.body.innerText),
    };
  });
}

const COUNT_LINE = /^([\d.,]+\s*[KMB]?)\s+(posts?|followers?|following)$/i;
const PRONOUNS = /^(she|he|they|it|xe|ze|any)\/[a-z]+(\/[a-z]+)?$/i;
// Header text that's UI chrome, not profile content (logged-in header).
const CHROME = /^(follow|following|followers|posts?|follow back|requested|message|contact|email|call|options|subscribe|edit profile|view archive|share profile|verified|link icon|more|and)$/i;
const MAX_CATEGORY_LEN = 40;

export function parseInstagram(snap: InstagramSnapshot, handle: string): ProfileDetails {
  const meta = snap.metaDescription ?? "";
  const metaCount = (label: string) =>
    parseCount(meta.match(new RegExp(`([\\d.,]+[KMB]?)\\s+${label}`, "i"))?.[1]);

  // Header counts first — the meta description is often stale.
  const counts: Record<string, number | null> = { posts: null, followers: null, following: null };
  for (const line of snap.headerLines) {
    const m = line.match(COUNT_LINE);
    if (m) {
      const key = m[2].toLowerCase().startsWith("post")
        ? "posts"
        : m[2].toLowerCase() === "following"
          ? "following"
          : "followers";
      counts[key] = parseCount(m[1]);
    }
  }
  const followers = parseCount(snap.followersTitle) ?? counts.followers ?? metaCount("Followers");
  const following = counts.following ?? metaCount("Following");
  const posts = counts.posts ?? metaCount("Posts");

  const displayName = snap.ogTitle?.match(/^(.*?)\s*\(@[^)]+\)/)?.[1]?.trim() ?? "";

  const bio =
    snap.bio ?? meta.match(/on Instagram: "([\s\S]*)"\s*$/)?.[1]?.trim() ?? "";
  const bioLines = new Set(bio.split("\n").map((l) => l.trim()).filter(Boolean));

  const linkMatch = snap.linkText?.match(/^(.+?)(?:\s+and\s+(\d+)\s+more)?$/i);
  const links = linkMatch ? [linkMatch[1].trim()] : [];
  const moreLinks = linkMatch?.[2] ? Number(linkMatch[2]) : 0;

  const pronouns =
    snap.textBlocks.find((b) => PRONOUNS.test(b)) ?? snap.headerLines.find((l) => PRONOUNS.test(l)) ?? "";

  // The category label ("Digital creator") has no hook of its own. It's the
  // short block left over *before the bio* once everything we can identify
  // is removed. Empty rather than a guess when nothing qualifies.
  const highlights = new Set(snap.highlights);
  const blocks = snap.textBlocks.length ? snap.textBlocks : snap.headerLines;
  const isBioPart = (b: string) => bioLines.has(b) || (b.length >= 8 && bio.includes(b));
  const firstBioIdx = blocks.findIndex(isBioPart);
  const beforeBio = firstBioIdx === -1 ? blocks : blocks.slice(0, firstBioIdx);
  const category =
    beforeBio.find(
      (b) =>
        b !== handle &&
        b !== displayName &&
        b !== pronouns &&
        !b.startsWith(displayName || "\u0000") &&
        !COUNT_LINE.test(b) &&
        !CHROME.test(b) &&
        !/^followed by /i.test(b) &&
        !b.startsWith("@") &&
        !highlights.has(b) &&
        !(snap.linkText ?? "").includes(b) &&
        b.length <= MAX_CATEGORY_LEN &&
        !/\d/.test(b),
    ) ?? "";

  return {
    displayName,
    bio,
    followers,
    following,
    posts,
    likes: null,
    verified: snap.verified,
    isPrivate: snap.privateNotice,
    category,
    pronouns,
    links,
    moreLinks,
    mentions: extractMentions(bio).filter((m) => m.toLowerCase() !== handle.toLowerCase()),
    highlights: snap.highlights,
    email: extractEmail(bio),
  };
}

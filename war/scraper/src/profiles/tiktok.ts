import type { Page } from "playwright";
import { extractEmail, extractMentions, parseCount, type ProfileDetails } from "./parse.js";

// Reads a TikTok profile from what's rendered on screen via TikTok's
// data-e2e test hooks — not the embedded rehydration JSON, which carries far
// more than the page displays (see docs/instagram-profile-data.md, MVP).

export interface TikTokSnapshot {
  title: string | null;
  subtitle: string | null;
  following: string | null;
  followers: string | null;
  likes: string | null;
  bio: string | null;
  link: string | null;
  verified: boolean;
  privateNotice: boolean;
}

export async function snapshotTikTok(page: Page): Promise<TikTokSnapshot | null> {
  return page.evaluate(() => {
    const subtitle = document.querySelector('[data-e2e="user-subtitle"]') as HTMLElement | null;
    if (!subtitle) return null;
    return {
      title: (document.querySelector('[data-e2e="user-title"]') as HTMLElement | null)?.innerText.trim() ?? null,
      subtitle: subtitle.innerText.trim(),
      following: (document.querySelector('[data-e2e="following-count"]') as HTMLElement | null)?.innerText.trim() ?? null,
      followers: (document.querySelector('[data-e2e="followers-count"]') as HTMLElement | null)?.innerText.trim() ?? null,
      likes: (document.querySelector('[data-e2e="likes-count"]') as HTMLElement | null)?.innerText.trim() ?? null,
      bio: (document.querySelector('[data-e2e="user-bio"]') as HTMLElement | null)?.innerText.trim() ?? null,
      link: (document.querySelector('[data-e2e="user-link"]') as HTMLElement | null)?.innerText.trim() ?? null,
      // The blue check is an unlabelled svg placed right after the handle.
      verified: !!document.querySelector('[data-e2e="user-subtitle"] ~ svg'),
      privateNotice: /this account is private/i.test(document.body.innerText),
    };
  });
}

// TikTok renders this placeholder when there's no bio.
const EMPTY_BIO = /^no bio yet\.?$/i;

export function parseTikTok(snap: TikTokSnapshot): ProfileDetails {
  const bio = snap.bio && !EMPTY_BIO.test(snap.bio) ? snap.bio : "";
  const handle = snap.subtitle ?? "";
  return {
    displayName: snap.title ?? "",
    bio,
    followers: parseCount(snap.followers),
    following: parseCount(snap.following),
    posts: null,
    likes: parseCount(snap.likes),
    verified: snap.verified,
    isPrivate: snap.privateNotice,
    category: "",
    pronouns: "",
    links: snap.link ? [snap.link] : [],
    moreLinks: 0,
    mentions: extractMentions(bio).filter((m) => m.toLowerCase() !== handle.toLowerCase()),
    highlights: [],
    email: extractEmail(bio),
  };
}

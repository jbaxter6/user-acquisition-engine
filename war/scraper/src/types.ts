import type { ProfileDetails } from "./profiles/parse.js";

export type Platform = "instagram" | "tiktok" | "twitch" | "youtube";

export interface Prospect {
  username: string;
  platform: Platform;
  displayName: string;
  // null = unknown (account couldn't be read, or a platform we don't read).
  followers: number | null;
  notes: string;
  email: string;
  url: string;
  // Everything read off the profile header (Instagram/TikTok). Twitch
  // doesn't fill this yet.
  details?: ProfileDetails;
}

export interface SourceOptions {
  category: string;
  minFollowers: number;
  maxFollowers: number;
  limit: number;
  keywords: string[];
  // "platform:lowercased-username" of people we already have; skip them.
  skip?: Set<string>;
  // Called for each prospect as soon as it's accepted, so a run that's
  // interrupted or crashes can still save what it found (see gracefulExit.ts).
  onProspect?: (p: Prospect) => void;
}

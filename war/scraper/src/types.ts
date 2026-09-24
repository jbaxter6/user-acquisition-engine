export interface Prospect {
  username: string;
  platform: "twitch" | "instagram" | "tiktok";
  displayName: string;
  followers: number;
  notes: string;
  email: string;
  url: string;
}

export interface SourceOptions {
  category: string;
  minFollowers: number;
  maxFollowers: number;
  limit: number;
  keywords: string[];
  // "platform:lowercased-username" of people we already have; skip them.
  skip?: Set<string>;
}

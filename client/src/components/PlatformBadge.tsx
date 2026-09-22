import type { Platform } from "../types";

const LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitch: "Twitch",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return <span className={`platform-badge platform-badge--${platform}`}>{LABELS[platform]}</span>;
}

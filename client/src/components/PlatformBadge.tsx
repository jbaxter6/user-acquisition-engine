import type { Platform } from "../types";
import { PlatformIcon } from "./PlatformIcon";

const LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitch: "Twitch",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span className={`platform-badge platform-badge--${platform}`} title={LABELS[platform]} aria-label={LABELS[platform]}>
      <PlatformIcon platform={platform} size={12} />
    </span>
  );
}

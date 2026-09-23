import { PlatformIcon } from "./PlatformIcon";
import type { Platform } from "../types";

interface Props {
  platform: Platform;
  count: number;
  title?: string;
}

// Static counterpart to AccountConnection's button — same look, but for
// platforms with no connect flow to open (TikTok, Twitch), so count is
// always 0 and always shows red. Kept as its own component so a real
// connect flow can replace this later without touching the styling.
export function PlatformStatusChip({ platform, count, title }: Props) {
  return (
    <span className="platform-status-btn platform-status-btn--static" title={title}>
      <span
        className={
          count > 0 ? "platform-status-dot platform-status-dot--connected" : "platform-status-dot platform-status-dot--disconnected"
        }
      />
      <PlatformIcon platform={platform} size={14} />
      <span>{count}</span>
    </span>
  );
}

import type { MessagingAdapter, Platform, SendResult } from "./types.js";
import { UnsupportedOperationError } from "./types.js";

/**
 * Placeholder for platforms with no send/receive API available to this
 * project (TikTok has no public DM API; Twitch's Whispers API is closed to
 * new app registrations). Conversations and messages for these platforms
 * are entered manually via POST /api/conversations/manual — see README.
 */
export class StubAdapter implements MessagingAdapter {
  platform: Platform;
  canSend = false;

  constructor(platform: Platform) {
    this.platform = platform;
  }

  async sendMessage(): Promise<SendResult> {
    throw new UnsupportedOperationError(this.platform, "sendMessage");
  }
}

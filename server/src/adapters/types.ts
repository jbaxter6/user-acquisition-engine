export type Platform = "instagram" | "tiktok" | "twitch";

export class UnsupportedOperationError extends Error {
  constructor(platform: Platform, operation: string) {
    super(`${platform} adapter does not support ${operation}`);
    this.name = "UnsupportedOperationError";
  }
}

export interface SendResult {
  externalMessageId: string;
}

/**
 * Common interface every platform integration implements. Real adapters
 * (Instagram) call the platform's API. Stub adapters (TikTok, Twitch) exist
 * so the rest of the app can treat all three platforms uniformly, but throw
 * UnsupportedOperationError on send since no send-capable API exists for
 * them yet — replies for those platforms are logged manually instead.
 */
export interface MessagingAdapter {
  platform: Platform;
  /** Whether sendMessage() actually reaches the platform, or is a manual-only stub. */
  canSend: boolean;
  sendMessage(externalConversationId: string, text: string): Promise<SendResult>;
}

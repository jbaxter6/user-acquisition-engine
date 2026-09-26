import type { MessagingAdapter, SendResult } from "./types.js";
import { metaFetch } from "../meta/metaFetch.js";

const GRAPH_API_VERSION = "v21.0";

/**
 * Real integration against the Instagram API with Instagram Login (business
 * login) — https://graph.instagram.com. Each account connected via the
 * OAuth flow in routes/auth.ts gets its own adapter instance, since each
 * has its own Instagram User ID and access token (no Facebook Page
 * involved). Sending only works within Meta's 24h reply window — see
 * README "Instagram Setup".
 */
export class InstagramAdapter implements MessagingAdapter {
  platform = "instagram" as const;
  canSend = true;

  private accountId: number;
  private igUserId: string;
  private accessToken: string;

  constructor(accountId: number, igUserId: string, accessToken: string) {
    this.accountId = accountId;
    this.igUserId = igUserId;
    this.accessToken = accessToken;
  }

  async sendMessage(externalConversationId: string, text: string): Promise<SendResult> {
    const url = `https://graph.instagram.com/${GRAPH_API_VERSION}/${this.igUserId}/messages?access_token=${encodeURIComponent(
      this.accessToken
    )}`;

    const res = await metaFetch(this.accountId, "send", url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: externalConversationId },
        message: { text },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Instagram send failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { message_id: string };
    return { externalMessageId: data.message_id };
  }
}

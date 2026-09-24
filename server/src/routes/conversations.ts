import { Router } from "express";
import {
  conversationHasInboundMessage,
  db,
  insertMessage,
  upsertConversation,
  type ConversationRow,
} from "../db.js";
import { getInstagramAdapterForAccount, getStubAdapters } from "../adapters/index.js";
import { StubAdapter } from "../adapters/stub.js";
import type { MessagingAdapter, Platform } from "../adapters/types.js";

const PLATFORMS: Platform[] = ["instagram", "tiktok", "twitch"];

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

export function conversationsRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const platform = req.query.platform;
    // Correlated subqueries pull each conversation's most recent message
    // for a list-view preview, without a separate round trip per row.
    // has_engaged: whether the other party has ever actually messaged us in
    // this conversation, vs. it being outbound-only so far (we reached out,
    // no reply yet). Meta won't hand over a participant's profile/avatar
    // until they've engaged — see instagramProfile.ts — so the UI uses this
    // to show "not yet engaged" instead of a normal missing-photo fallback.
    const selectWithPreview = `
      SELECT c.*,
        (SELECT m.text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_text,
        (SELECT m.direction FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_direction,
        EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS has_engaged
      FROM conversations c
    `;
    const rows = platform
      ? db
          .prepare<[string], ConversationRow>(`${selectWithPreview} WHERE c.platform = ? ORDER BY c.last_message_at DESC`)
          .all(String(platform))
      : db
          .prepare<[], ConversationRow>(`${selectWithPreview} ORDER BY c.last_message_at DESC`)
          .all();
    res.json(rows);
  });

  router.get("/:id/messages", (req, res) => {
    const rows = db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC")
      .all(req.params.id);
    res.json(rows);
  });

  // Send a reply. For platforms with a real adapter (Instagram), this calls
  // the platform API. For stub platforms (TikTok, Twitch) it records the
  // message as sent-manually, since there's no API to call yet.
  router.post("/:id/messages", async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const conversation = db
      .prepare<[string], ConversationRow>("SELECT * FROM conversations WHERE id = ?")
      .get(req.params.id);
    if (!conversation) return res.status(404).json({ error: "conversation not found" });

    let adapter: MessagingAdapter;
    if (conversation.platform === "instagram") {
      adapter = conversation.account_id
        ? getInstagramAdapterForAccount(conversation.account_id)
        : new StubAdapter("instagram");
    } else {
      adapter = getStubAdapters()[conversation.platform as "tiktok" | "twitch"];
    }

    if (adapter.canSend) {
      // API replies are only allowed once the other person has messaged us.
      if (!conversationHasInboundMessage(conversation.id)) {
        return res.status(403).json({
          error: "You can reply once they've messaged you first.",
        });
      }
      try {
        const result = await adapter.sendMessage(conversation.external_id, text);
        const message = insertMessage(conversation.id, "outbound", text, "api", result.externalMessageId);
        return res.status(201).json(message);
      } catch (err) {
        return res.status(502).json({ error: (err as Error).message });
      }
    }

    // Stub platform: record that a VA sent this manually on the platform itself.
    const message = insertMessage(conversation.id, "outbound", text, "manual");
    res.status(201).json(message);
  });

  // For platforms without a receive webhook (TikTok, Twitch), log an
  // inbound message a VA saw on the platform directly, so it shows up in
  // the unified inbox alongside Instagram's webhook-delivered messages.
  router.post("/manual", (req, res) => {
    const { platform, participantHandle, participantName, text } = req.body as {
      platform?: string;
      participantHandle?: string;
      participantName?: string;
      text?: string;
    };

    if (!isPlatform(platform)) {
      return res.status(400).json({ error: `platform must be one of ${PLATFORMS.join(", ")}` });
    }
    if (!participantHandle || !text) {
      return res.status(400).json({ error: "participantHandle and text are required" });
    }

    // Manual entries don't have a stable external id from the platform, so
    // we key the conversation on the handle itself.
    const conversation = upsertConversation(platform, participantHandle, participantHandle, participantName);
    const message = insertMessage(conversation.id, "inbound", text, "manual");
    res.status(201).json({ conversation, message });
  });

  return router;
}

import { Router } from "express";
import { getAccountByIgUserId, insertMessage, upsertConversation } from "../db.js";
import { backfillParticipantAvatar } from "../instagramProfile.js";

interface InstagramWebhookBody {
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: {
        sender?: { id?: string };
        recipient?: { id?: string };
        message?: { mid?: string; text?: string; is_echo?: boolean };
      };
    }>;
  }>;
}

export function webhooksRouter(): Router {
  const router = Router();

  // Meta's one-time webhook verification handshake.
  router.get("/instagram", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    res.sendStatus(403);
  });

  // Incoming messages, shared across every connected account — recipient.id
  // says which of our accounts (main or satellite) the message came in on.
  router.post("/instagram", (req, res) => {
    const body = req.body as InstagramWebhookBody;
    console.log("Instagram webhook received:", JSON.stringify(body));

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        const senderId = change.value?.sender?.id;
        const recipientId = change.value?.recipient?.id;
        const text = change.value?.message?.text;
        // is_echo events are messages *we* sent, already recorded on send.
        if (!senderId || !recipientId || !text || change.value?.message?.is_echo) continue;

        const account = getAccountByIgUserId(recipientId);
        const conversation = upsertConversation("instagram", senderId, senderId, undefined, account?.id);
        insertMessage(conversation.id, "inbound", text, "webhook", change.value?.message?.mid);
        // Not awaited — avatar lookup shouldn't delay the webhook ack Meta expects.
        if (account) void backfillParticipantAvatar(conversation, account.access_token);
      }
    }

    res.sendStatus(200);
  });

  return router;
}

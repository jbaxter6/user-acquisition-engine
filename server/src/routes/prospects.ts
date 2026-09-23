import { Router } from "express";
import {
  bulkInsertProspects,
  deleteProspect,
  getAccountById,
  getProspectById,
  insertMessage,
  listProspects,
  markProspectContacted,
  upsertConversation,
  type ProspectInput,
} from "../db.js";
import { ProspectMessageError, sendProspectMessage } from "../prospecting.js";

export function prospectsRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { platform, status } = req.query as { platform?: string; status?: string };
    res.json(listProspects({ platform, status }));
  });

  // Expects rows already parsed/column-mapped client-side (the Excel file
  // itself never touches the server) — just a JSON array to insert.
  router.post("/bulk", (req, res) => {
    const { prospects } = req.body as { prospects?: unknown };
    if (!Array.isArray(prospects) || prospects.length === 0) {
      return res.status(400).json({ error: "prospects must be a non-empty array" });
    }

    const rows: ProspectInput[] = [];
    for (const p of prospects) {
      if (typeof p !== "object" || p === null) continue;
      const { username, platform, displayName, followers, notes, email } = p as Record<string, unknown>;
      if (typeof username !== "string" || !username.trim()) continue;
      rows.push({
        platform: typeof platform === "string" && platform ? platform : "instagram",
        username: username.trim().replace(/^@/, ""),
        displayName: typeof displayName === "string" ? displayName : undefined,
        followers: typeof followers === "number" ? followers : undefined,
        notes: typeof notes === "string" ? notes : undefined,
        email: typeof email === "string" ? email : undefined,
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: "no valid rows (each needs at least a username)" });
    }

    const inserted = bulkInsertProspects(rows);
    res.status(201).json({ received: rows.length, inserted, skipped: rows.length - inserted });
  });

  router.delete("/:id", (req, res) => {
    deleteProspect(Number(req.params.id));
    res.json({ ok: true });
  });

  // Attempts a real first-contact send via the API. This is expected to
  // fail for genuinely cold outreach in many cases — Meta's Messaging API
  // is built around responding within an existing conversation. On
  // failure, the error is returned as-is so the UI can offer "mark
  // contacted manually" instead of pretending this always works.
  router.post("/:id/message", async (req, res) => {
    const { accountId, text } = req.body as { accountId?: number; text?: string };
    if (!accountId || !text?.trim()) {
      return res.status(400).json({ error: "accountId and text are required" });
    }

    const prospect = getProspectById(Number(req.params.id));
    if (!prospect) return res.status(404).json({ error: "prospect not found" });

    try {
      const result = await sendProspectMessage(prospect, accountId, text.trim());
      res.json(result);
    } catch (err) {
      const message = err instanceof ProspectMessageError ? err.message : (err as Error).message;
      res.status(502).json({ error: message });
    }
  });

  // Fallback for when a real API send fails (e.g. outside the messaging
  // window, which is expected for genuine cold outreach): the user sent it
  // themselves from the connected account's native app, and is just
  // logging that here — same pattern as TikTok/Twitch manual entries.
  router.post("/:id/mark-contacted", (req, res) => {
    const { accountId, text } = req.body as { accountId?: number; text?: string };
    if (!accountId || !text?.trim()) {
      return res.status(400).json({ error: "accountId and text are required" });
    }

    const prospect = getProspectById(Number(req.params.id));
    if (!prospect) return res.status(404).json({ error: "prospect not found" });
    if (!getAccountById(accountId)) return res.status(400).json({ error: "connected account not found" });

    // Without a resolved real ID, key the conversation on the username —
    // same fallback manual TikTok/Twitch conversations already use.
    const externalId = prospect.resolved_ig_user_id ?? prospect.username;
    const conversation = upsertConversation(
      prospect.platform,
      externalId,
      prospect.username,
      prospect.display_name ?? undefined,
      accountId
    );
    insertMessage(conversation.id, "outbound", text.trim(), "manual");
    markProspectContacted(prospect.id, accountId, conversation.id);

    res.json({ conversationId: conversation.id });
  });

  return router;
}

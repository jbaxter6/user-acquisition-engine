import { Router } from "express";
import {
  bulkInsertProspects,
  deleteProspect,
  ensureProspectForParticipant,
  getAccountById,
  getProspectById,
  insertMessage,
  linkProspectChannel,
  linkProspectManager,
  listProspectChannels,
  listProspectContacts,
  listProspectLinks,
  listProspects,
  markProspectContacted,
  mergeProspectIntoTarget,
  unlinkProspects,
  upsertConversation,
  upsertProspectContact,
  type ProspectInput,
} from "../db.js";
import { ProspectMessageError, sendProspectMessage } from "../prospecting.js";

const PLATFORMS = ["instagram", "tiktok", "twitch"];

export function prospectsRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { platform, status } = req.query as {
      platform?: string;
      status?: string;
    };
    const prospects = listProspects({ platform, status });
    res.json(
      prospects.map((prospect) => ({
        ...prospect,
        channels: listProspectChannels(prospect.id),
        contacts: listProspectContacts(prospect.id),
        links: listProspectLinks(prospect.id),
      })),
    );
  });

  // Expects rows already parsed/column-mapped client-side (the Excel file
  // itself never touches the server) — just a JSON array to insert.
  router.post("/bulk", (req, res) => {
    const { prospects } = req.body as { prospects?: unknown };
    if (!Array.isArray(prospects) || prospects.length === 0) {
      return res
        .status(400)
        .json({ error: "prospects must be a non-empty array" });
    }

    const rows: ProspectInput[] = [];
    for (const p of prospects) {
      if (typeof p !== "object" || p === null) continue;
      const { username, platform, displayName, followers, notes, email } =
        p as Record<string, unknown>;
      if (typeof username !== "string" || !username.trim()) continue;
      const normalizedPlatform =
        typeof platform === "string" ? platform.toLowerCase() : "";
      rows.push({
        platform: PLATFORMS.includes(normalizedPlatform)
          ? normalizedPlatform
          : "instagram",
        username: username.trim().replace(/^@/, ""),
        displayName: typeof displayName === "string" ? displayName : undefined,
        followers: typeof followers === "number" ? followers : undefined,
        notes: typeof notes === "string" ? notes : undefined,
        email: typeof email === "string" ? email : undefined,
      });
    }

    if (rows.length === 0) {
      return res
        .status(400)
        .json({ error: "no valid rows (each needs at least a username)" });
    }

    const inserted = bulkInsertProspects(rows);
    res
      .status(201)
      .json({
        received: rows.length,
        inserted,
        skipped: rows.length - inserted,
      });
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
    const { accountId, text, templateId } = req.body as {
      accountId?: number;
      text?: string;
      templateId?: number;
    };
    if (!accountId || !text?.trim()) {
      return res.status(400).json({ error: "accountId and text are required" });
    }

    const prospect = getProspectById(Number(req.params.id));
    if (!prospect) return res.status(404).json({ error: "prospect not found" });

    try {
      const result = await sendProspectMessage(
        prospect,
        accountId,
        text.trim(),
        templateId,
      );
      res.json(result);
    } catch (err) {
      const message =
        err instanceof ProspectMessageError
          ? err.message
          : (err as Error).message;
      res.status(502).json({ error: message });
    }
  });

  // Fallback for when a real API send fails (e.g. outside the messaging
  // window, which is expected for genuine cold outreach): the user sent it
  // themselves from the connected account's native app, and is just
  // logging that here — same pattern as TikTok/Twitch manual entries.
  router.post("/:id/mark-contacted", (req, res) => {
    const { accountId, text, templateId } = req.body as {
      accountId?: number;
      text?: string;
      templateId?: number;
    };
    const prospect = getProspectById(Number(req.params.id));
    if (!prospect) return res.status(404).json({ error: "prospect not found" });

    // Only Instagram prospects have a connected account to attribute this
    // to — TikTok/Twitch have no account concept, same as their existing
    // manual-only conversations.
    if (prospect.platform === "instagram") {
      if (!accountId)
        return res
          .status(400)
          .json({ error: "accountId is required for Instagram prospects" });
      if (!getAccountById(accountId))
        return res.status(400).json({ error: "connected account not found" });
    }
    if (!text?.trim()) {
      return res.status(400).json({ error: "text is required" });
    }
    const resolvedAccountId =
      prospect.platform === "instagram" ? accountId! : null;

    // Without a resolved real ID, key the conversation on the username —
    // same fallback manual TikTok/Twitch conversations already use.
    const externalId = prospect.resolved_ig_user_id ?? prospect.username;
    const conversation = upsertConversation(
      prospect.platform,
      externalId,
      prospect.username,
      prospect.display_name ?? undefined,
      resolvedAccountId ?? undefined,
    );
    insertMessage(
      conversation.id,
      "outbound",
      text.trim(),
      "manual",
      undefined,
      undefined,
      templateId,
    );
    markProspectContacted(prospect.id, resolvedAccountId, conversation.id);

    res.json({ conversationId: conversation.id });
  });

  router.post("/:id/contacts", (req, res) => {
    const { handle, name, role, isPrimary } = req.body as {
      handle?: string;
      name?: string;
      role?: string;
      isPrimary?: boolean;
    };
    const prospect = getProspectById(Number(req.params.id));
    if (!prospect) return res.status(404).json({ error: "prospect not found" });
    if (!handle?.trim())
      return res.status(400).json({ error: "handle is required" });

    const contact = upsertProspectContact(Number(req.params.id), {
      platform: prospect.platform,
      handle,
      name,
      role: role ?? "manager",
      source: "manual",
      isPrimary: !!isPrimary,
    });

    res.status(201).json(contact);
  });

  // Ties a platform/username to this prospect card as a "tied social
  // profile." Both cards stay independent — see linkProspectChannel.
  router.post("/:id/channels", (req, res) => {
    const { platform, username } = req.body as {
      platform?: string;
      username?: string;
    };
    if (!platform?.trim() || !username?.trim()) {
      return res.status(400).json({ error: "platform and username are required" });
    }
    const prospectId = Number(req.params.id);
    try {
      const linked = linkProspectChannel(prospectId, platform, username);
      res.status(201).json({
        ...linked,
        channels: listProspectChannels(prospectId),
        contacts: listProspectContacts(prospectId),
        links: listProspectLinks(prospectId),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "link failed";
      res.status(400).json({ error: message });
    }
  });

  // Ties a platform/username to this prospect card as a "connected
  // manager/rep," labeled with a role — same non-merging linkage as
  // /:id/channels above.
  router.post("/:id/managers", (req, res) => {
    const { platform, username, role } = req.body as {
      platform?: string;
      username?: string;
      role?: string;
    };
    if (!platform?.trim() || !username?.trim()) {
      return res.status(400).json({ error: "platform and username are required" });
    }
    const prospectId = Number(req.params.id);
    try {
      const linked = linkProspectManager(prospectId, platform, username, role ?? "manager");
      res.status(201).json({
        ...linked,
        channels: listProspectChannels(prospectId),
        contacts: listProspectContacts(prospectId),
        links: listProspectLinks(prospectId),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "link failed";
      res.status(400).json({ error: message });
    }
  });

  router.delete("/:id/links/:linkedId", (req, res) => {
    unlinkProspects(Number(req.params.id), Number(req.params.linkedId));
    res.json({ ok: true });
  });

  router.post("/:id/merge", (req, res) => {
    const targetId = Number(req.body?.targetId ?? req.query?.targetId);
    const sourceId = Number(req.params.id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: "targetId is required" });
    }
    if (sourceId === targetId) {
      return res.json(getProspectById(targetId));
    }
    try {
      const merged = mergeProspectIntoTarget(sourceId, targetId);
      res.json({
        ...merged,
        channels: listProspectChannels(targetId),
        contacts: listProspectContacts(targetId),
        links: listProspectLinks(targetId),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "merge failed";
      res.status(400).json({ error: message });
    }
  });

  return router;
}

import { Router } from "express";
import {
  bulkInsertProspects,
  countProspectsByStatus,
  deleteProspect,
  ensureProspectForParticipant,
  findConversationByHandle,
  getAccountById,
  listConversationsByHandle,
  getConversationAvatarInfo,
  getFirstOutboundMessage,
  getProspectById,
  insertMessage,
  linkProspectChannel,
  linkProspectManager,
  listProspectChannels,
  listProspectContacts,
  listProspectHandles,
  listProspectLinks,
  listProspects,
  markProspectContacted,
  mergeProspectIntoTarget,
  unlinkProspects,
  upsertConversation,
  upsertProspectContact,
  type ProspectInput,
  type ProspectSort,
} from "../db.js";

const PLATFORMS = ["instagram", "tiktok", "twitch", "youtube"];

export function prospectsRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { platform, status, q, sort, limit, offset } = req.query as Record<
      string,
      string | undefined
    >;
    const { items, total } = listProspects({
      platform,
      status,
      q,
      sort: sort as ProspectSort | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json({
      total,
      items: items.map((prospect) => {
        // Every thread with this person (one per connected account that has
        // messaged them), each with the account that sent its first message.
        const conversations = listConversationsByHandle(
          prospect.platform,
          prospect.username,
        );
        const threads = conversations
          .map((conversation) => {
            const first = getFirstOutboundMessage(conversation.id) ?? null;
            const account =
              conversation.account_id != null
                ? getAccountById(conversation.account_id)
                : undefined;
            const info = getConversationAvatarInfo(conversation.id);
            return {
              conversation_id: conversation.id,
              account: account
                ? {
                    id: account.id,
                    username: account.username,
                    profile_picture_url: account.profile_picture_url,
                  }
                : null,
              first_outbound: first,
              avatar_url: info?.avatar_url ?? null,
              has_engaged: info?.has_engaged ?? false,
            };
          })
          .sort((a, b) =>
            (a.first_outbound?.created_at ?? "9999").localeCompare(
              b.first_outbound?.created_at ?? "9999",
            ),
          );
        const earliestOutbound =
          threads.find((t) => t.first_outbound)?.first_outbound ?? null;
        const existingConversationId =
          prospect.conversation_id ?? threads[0]?.conversation_id ?? null;
        return {
          ...prospect,
          channels: listProspectChannels(prospect.id),
          contacts: listProspectContacts(prospect.id),
          links: listProspectLinks(prospect.id),
          existing_conversation_id: existingConversationId,
          threads,
          first_outbound_message: earliestOutbound,
          avatar_url: threads.find((t) => t.avatar_url)?.avatar_url ?? null,
          // No thread yet also counts as "hasn't engaged", like the inbox.
          has_engaged: threads.some((t) => t.has_engaged),
        };
      }),
    });
  });

  router.get("/handles", (_req, res) => {
    res.json(listProspectHandles());
  });

  router.get("/counts", (req, res) => {
    const { platform, q } = req.query as Record<string, string | undefined>;
    res.json(countProspectsByStatus({ platform, q }));
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
      const row = {
        platform: PLATFORMS.includes(normalizedPlatform)
          ? normalizedPlatform
          : "instagram",
        username: username.trim().replace(/^@/, ""),
        displayName: typeof displayName === "string" ? displayName : undefined,
        followers: typeof followers === "number" ? followers : undefined,
        notes: typeof notes === "string" ? notes : undefined,
        email: typeof email === "string" ? email : undefined,
      };
      rows.push(row);
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

    // Prefer an already-existing conversation for this handle (e.g. synced
    // from a webhook under their real platform ID) over creating a new one
    // keyed by username — otherwise a prospect who already DM'd in would
    // end up with a second, disconnected "shadow" thread here.
    const existing = findConversationByHandle(prospect.platform, prospect.username);
    const externalId = existing?.external_id ?? prospect.resolved_ig_user_id ?? prospect.username;
    const conversation = upsertConversation(
      prospect.platform,
      externalId,
      prospect.username,
      prospect.display_name ?? undefined,
      existing?.account_id ?? resolvedAccountId ?? undefined,
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

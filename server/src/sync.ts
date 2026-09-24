import {
  conversationHasInboundMessage,
  ensureProspectForParticipant,
  syncProspectContactedAt,
  findMessageByContent,
  getMessageByExternalId,
  insertMessage,
  recomputeConversationLastMessageAt,
  updateMessageCreatedAt,
  upsertAccount,
  upsertConversation,
  type AccountRow,
  type ConversationRow,
} from "./db.js";
import { backfillParticipantAvatar } from "./instagramProfile.js";

const GRAPH_API_VERSION = "v21.0";

interface ConversationsListResponse {
  data: Array<{ id: string; updated_time: string }>;
  paging?: { next?: string };
}

interface ConversationMessagesResponse {
  messages?: { data: Array<{ id: string }> };
}

interface MessageDetailResponse {
  id: string;
  created_time: string;
  message?: string;
  from: { id: string; username?: string };
  to: { data: Array<{ id: string; username?: string }> };
}

// Normalizes Instagram's ISO 8601 timestamp (e.g. "2022-07-12T19:11:07+0000")
// to the same "YYYY-MM-DD HH:MM:SS" UTC text format SQLite's datetime('now')
// produces elsewhere, so plain string comparison still sorts correctly
// regardless of which code path inserted a given row.
function toSqliteUtc(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Pulls conversation/message history directly via the Graph API GET
 * endpoints, independent of webhook push delivery. Exists because real
 * webhook events for messages don't appear to be delivered pre-App-Review
 * even for tester-to-tester conversations, while this direct read works
 * with any valid account token — see WORKLOG.md for how that was diagnosed.
 */
export async function syncInstagramAccount(
  account: AccountRow,
): Promise<{ conversations: number; newMessages: number }> {
  // Opportunistically refresh the avatar/username for accounts connected
  // before profile_picture_url was tracked, since we're already spending
  // an API call on this account anyway.
  const profileUrl = new URL(
    `https://graph.instagram.com/${GRAPH_API_VERSION}/me`,
  );
  profileUrl.searchParams.set("fields", "user_id,username,profile_picture_url");
  profileUrl.searchParams.set("access_token", account.access_token);
  const profileRes = await fetch(profileUrl);
  if (profileRes.ok) {
    const profile = (await profileRes.json()) as {
      username?: string;
      profile_picture_url?: string;
    };
    upsertAccount({
      igUserId: account.ig_user_id,
      username: profile.username ?? account.username ?? undefined,
      profilePictureUrl: profile.profile_picture_url,
      accessToken: account.access_token,
    });
  }

  const firstUrl = new URL(
    `https://graph.instagram.com/${GRAPH_API_VERSION}/me/conversations`,
  );
  firstUrl.searchParams.set("platform", "instagram");
  firstUrl.searchParams.set("access_token", account.access_token);

  // The first page has come back empty while still reporting a `next`
  // cursor in testing — follow pagination for a few pages rather than
  // trusting an empty first page means there's nothing to find.
  const conversations: Array<{ id: string; updated_time: string }> = [];
  let nextUrl: string | undefined = firstUrl.toString();
  let pageCount = 0;
  const MAX_PAGES = 5;

  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    const pageRes = await fetch(nextUrl);
    const pageRaw = await pageRes.text();
    console.log(
      `Instagram conversations page ${pageCount} for @${account.username} (ig_user_id=${account.ig_user_id}):`,
      pageRes.status,
      pageRaw,
    );
    if (!pageRes.ok) {
      throw new Error(`listing conversations failed: ${pageRaw}`);
    }
    const page = JSON.parse(pageRaw) as ConversationsListResponse;
    conversations.push(...page.data);
    nextUrl = page.paging?.next;
  }

  let newMessages = 0;

  for (const conversation of conversations) {
    const messagesUrl = new URL(
      `https://graph.instagram.com/${GRAPH_API_VERSION}/${conversation.id}`,
    );
    messagesUrl.searchParams.set("fields", "messages");
    messagesUrl.searchParams.set("access_token", account.access_token);

    const messagesRes = await fetch(messagesUrl);
    if (!messagesRes.ok) {
      console.error(
        `fetching conversation ${conversation.id} failed:`,
        await messagesRes.text(),
      );
      continue;
    }
    const { messages } =
      (await messagesRes.json()) as ConversationMessagesResponse;
    const messageIds = messages?.data ?? [];
    if (messageIds.length === 0) continue;

    // Fetch every message's detail every sync, not just new ones — needed
    // both to resolve which participant/conversation a message belongs to
    // (unconditionally skipping already-stored messages here previously
    // meant avatar backfill could never run once a conversation was fully
    // synced) and to repair any row whose created_at is wrong, e.g. from
    // before Sync tracked real send times at all. More API calls per sync
    // than a pure "only fetch new" approach, but this is a manually
    // triggered action, not a poll, so the cost is acceptable for the
    // correctness it buys.
    let dbConversation: ConversationRow | null = null;

    for (const { id: messageId } of messageIds) {
      const existing = getMessageByExternalId(messageId);

      const detailUrl = new URL(
        `https://graph.instagram.com/${GRAPH_API_VERSION}/${messageId}`,
      );
      detailUrl.searchParams.set("fields", "id,created_time,from,to,message");
      detailUrl.searchParams.set("access_token", account.access_token);

      const detailRes = await fetch(detailUrl);
      if (!detailRes.ok) {
        console.error(
          `fetching message ${messageId} failed:`,
          await detailRes.text(),
        );
        continue;
      }
      const detailRaw = await detailRes.text();
      console.log(
        `Message detail for ${messageId} (existing db row: ${existing?.id ?? "none"}):`,
        detailRaw,
      );
      const detail = JSON.parse(detailRaw) as MessageDetailResponse;
      if (!detail.message) continue;

      const isOutbound = detail.from.id === account.ig_user_id;
      const participant = isOutbound ? detail.to.data[0] : detail.from;
      if (!participant) continue;

      dbConversation = upsertConversation(
        "instagram",
        participant.id,
        participant.username ?? participant.id,
        undefined,
        account.id,
      );

      const correctCreatedAt = toSqliteUtc(detail.created_time);
      const direction = isOutbound ? "outbound" : "inbound";

      ensureProspectForParticipant({
        platform: "instagram",
        handle: participant.username ?? participant.id,
        name: participant.username ?? undefined,
        source: "sync",
        role: "primary",
        conversationId: dbConversation.id,
        accountId: account.id,
        direction,
      });

      if (existing) {
        if (existing.created_at !== correctCreatedAt) {
          updateMessageCreatedAt(existing.id, correctCreatedAt);
        }
      } else {
        // No row for this exact id — but messages sent through the native
        // Instagram app don't seem to keep a stable id across separate
        // Sync calls, so also check by content before assuming this is
        // genuinely new. Without this, the same real message resurfaces
        // as a duplicate every time Meta hands back a different id for it,
        // each with created_time ≈ whenever that sync happened to run.
        const contentMatch = findMessageByContent(
          dbConversation.id,
          direction,
          detail.message,
        );
        if (!contentMatch) {
          insertMessage(
            dbConversation.id,
            direction,
            detail.message,
            "api",
            detail.id,
            correctCreatedAt,
          );
          newMessages++;
        }
      }
    }

    if (dbConversation) {
      recomputeConversationLastMessageAt(dbConversation.id);
      syncProspectContactedAt(dbConversation.id);
      // Meta withholds profile access (avatar included) until the other
      // party has actually messaged us — an outbound-only conversation
      // will always fail this lookup, so skip it rather than burn an API
      // call every sync on something that can't succeed yet.
      if (conversationHasInboundMessage(dbConversation.id)) {
        await backfillParticipantAvatar(dbConversation, account.access_token);
      }
    }
  }

  return { conversations: conversations.length, newMessages };
}

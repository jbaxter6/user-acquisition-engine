import { db, insertMessage, upsertConversation, type AccountRow } from "./db.js";

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

function messageExists(externalMessageId: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM messages WHERE external_message_id = ? LIMIT 1")
    .get(externalMessageId);
}

/**
 * Pulls conversation/message history directly via the Graph API GET
 * endpoints, independent of webhook push delivery. Exists because real
 * webhook events for messages don't appear to be delivered pre-App-Review
 * even for tester-to-tester conversations, while this direct read works
 * with any valid account token — see WORKLOG.md for how that was diagnosed.
 */
export async function syncInstagramAccount(
  account: AccountRow
): Promise<{ conversations: number; newMessages: number }> {
  const firstUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/me/conversations`);
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
      pageRaw
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
    const messagesUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/${conversation.id}`);
    messagesUrl.searchParams.set("fields", "messages");
    messagesUrl.searchParams.set("access_token", account.access_token);

    const messagesRes = await fetch(messagesUrl);
    if (!messagesRes.ok) {
      console.error(`fetching conversation ${conversation.id} failed:`, await messagesRes.text());
      continue;
    }
    const { messages } = (await messagesRes.json()) as ConversationMessagesResponse;

    for (const { id: messageId } of messages?.data ?? []) {
      if (messageExists(messageId)) continue;

      const detailUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/${messageId}`);
      detailUrl.searchParams.set("fields", "id,created_time,from,to,message");
      detailUrl.searchParams.set("access_token", account.access_token);

      const detailRes = await fetch(detailUrl);
      if (!detailRes.ok) {
        console.error(`fetching message ${messageId} failed:`, await detailRes.text());
        continue;
      }
      const detail = (await detailRes.json()) as MessageDetailResponse;
      if (!detail.message) continue;

      const isOutbound = detail.from.id === account.ig_user_id;
      const participant = isOutbound ? detail.to.data[0] : detail.from;
      if (!participant) continue;

      const dbConversation = upsertConversation(
        "instagram",
        participant.id,
        participant.username ?? participant.id,
        undefined,
        account.id
      );
      insertMessage(
        dbConversation.id,
        isOutbound ? "outbound" : "inbound",
        detail.message,
        "api",
        detail.id
      );
      newMessages++;
    }
  }

  return { conversations: conversations.length, newMessages };
}

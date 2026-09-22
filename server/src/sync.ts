import { db, insertMessage, upsertConversation, type AccountRow } from "./db.js";

const GRAPH_API_VERSION = "v21.0";

interface ConversationsListResponse {
  data: Array<{ id: string; updated_time: string }>;
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
  const conversationsUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/me/conversations`);
  conversationsUrl.searchParams.set("platform", "instagram");
  conversationsUrl.searchParams.set("access_token", account.access_token);

  const conversationsRes = await fetch(conversationsUrl);
  const conversationsRaw = await conversationsRes.text();
  console.log(
    `Instagram conversations list for @${account.username} (ig_user_id=${account.ig_user_id}):`,
    conversationsRes.status,
    conversationsRaw
  );
  if (!conversationsRes.ok) {
    throw new Error(`listing conversations failed: ${conversationsRaw}`);
  }
  const { data: conversations } = JSON.parse(conversationsRaw) as ConversationsListResponse;

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

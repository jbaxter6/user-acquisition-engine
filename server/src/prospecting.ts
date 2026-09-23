import { InstagramAdapter } from "./adapters/instagram.js";
import {
  getAccountById,
  markProspectContacted,
  setProspectResolvedId,
  upsertConversation,
  insertMessage,
  type ProspectRow,
} from "./db.js";

const GRAPH_API_VERSION = "v21.0";

/**
 * Resolves a public Instagram username to its underlying user ID via the
 * Business Discovery API, using one of our own connected accounts' token.
 * Only works for the target being a Business/Creator account (Business
 * Discovery doesn't expose personal accounts) — which is expected here,
 * since prospects are other creators/brands, not random personal accounts.
 *
 * Unverified assumption, not confirmed against real data yet: that the id
 * Business Discovery returns is usable as a messaging recipient id. If
 * sends fail with an invalid-recipient-style error, that's the first
 * thing to suspect.
 */
async function resolveUsernameToIgUserId(
  discovererIgUserId: string,
  accessToken: string,
  username: string
): Promise<string | null> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/${discovererIgUserId}`);
  url.searchParams.set("fields", `business_discovery.username(${username}){id}`);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url);
  const raw = await res.text();
  console.log(`Business Discovery lookup for @${username}:`, res.status, raw);
  if (!res.ok) return null;

  const data = JSON.parse(raw) as { business_discovery?: { id?: string } };
  return data.business_discovery?.id ?? null;
}

export class ProspectMessageError extends Error {}

/**
 * Attempts to send a real first message to a prospect via the API. This is
 * a genuine cold-send attempt — Meta's Messaging API is built around
 * responding within an existing conversation, not initiating one, so
 * failure here (e.g. "outside allowed window") is a real, expected
 * possibility, not necessarily a bug. Callers should offer a manual
 * fallback (send from the native app, then mark contacted) rather than
 * treating a failure as unrecoverable.
 */
export async function sendProspectMessage(
  prospect: ProspectRow,
  accountId: number,
  text: string,
  templateId?: number
) {
  const account = getAccountById(accountId);
  if (!account) throw new ProspectMessageError("Connected account not found.");

  let igUserId = prospect.resolved_ig_user_id;
  if (!igUserId) {
    igUserId = await resolveUsernameToIgUserId(account.ig_user_id, account.access_token, prospect.username);
    if (!igUserId) {
      throw new ProspectMessageError(
        `Couldn't resolve @${prospect.username} to an Instagram account ID — they may not be a Business/Creator account, or the username may be wrong.`
      );
    }
    setProspectResolvedId(prospect.id, igUserId);
  }

  const adapter = new InstagramAdapter(account.ig_user_id, account.access_token);
  const result = await adapter.sendMessage(igUserId, text);

  const conversation = upsertConversation("instagram", igUserId, prospect.username, prospect.display_name ?? undefined, accountId);
  insertMessage(conversation.id, "outbound", text, "api", result.externalMessageId, undefined, templateId);
  markProspectContacted(prospect.id, accountId, conversation.id);

  return { conversationId: conversation.id };
}

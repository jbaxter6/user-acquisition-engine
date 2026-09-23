import { updateConversationAvatar, type ConversationRow } from "./db.js";

const GRAPH_API_VERSION = "v21.0";

/**
 * Looks up a message participant's profile (not our own connected
 * account — see adapters/instagram.ts's /me lookup for that). Only works
 * for Instagram-scoped IDs we already have a conversation with, per
 * Meta's User Profile API.
 */
export async function fetchParticipantProfile(
  igsid: string,
  accessToken: string
): Promise<{ username?: string; profilePicUrl?: string } | null> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/${igsid}`);
  url.searchParams.set("fields", "username,profile_pic");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url);
  const raw = await res.text();
  console.log(`Participant profile lookup for ${igsid}:`, res.status, raw);
  if (!res.ok) return null;
  const data = JSON.parse(raw) as { username?: string; profile_pic?: string };
  return { username: data.username, profilePicUrl: data.profile_pic };
}

/**
 * Fetches and stores a participant's avatar if we don't already have one —
 * safe to call on every message without re-fetching every time. Swallows
 * errors so a lookup failure never blocks message ingestion.
 */
export async function backfillParticipantAvatar(
  conversation: ConversationRow,
  accessToken: string
): Promise<void> {
  if (conversation.participant_avatar_url) return;
  try {
    const profile = await fetchParticipantProfile(conversation.external_id, accessToken);
    if (profile?.profilePicUrl) {
      updateConversationAvatar(conversation.id, profile.profilePicUrl);
    }
  } catch (err) {
    console.error(`Backfilling avatar for conversation ${conversation.id} failed:`, err);
  }
}

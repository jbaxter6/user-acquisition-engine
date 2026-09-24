import type { MessagingAdapter, Platform } from "./types.js";
import { InstagramAdapter } from "./instagram.js";
import { StubAdapter } from "./stub.js";
import { getAccountById, listAccounts } from "../db.js";

const tiktok = new StubAdapter("tiktok");
const twitch = new StubAdapter("twitch");
const youtube = new StubAdapter("youtube");

/**
 * Builds an Instagram adapter scoped to one connected account (main or
 * satellite). Returns a non-sending stub if the account doesn't exist —
 * callers check `.canSend` before relying on sendMessage().
 */
export function getInstagramAdapterForAccount(accountId: number): MessagingAdapter {
  const account = getAccountById(accountId);
  if (!account) return new StubAdapter("instagram");
  return new InstagramAdapter(account.ig_user_id, account.access_token);
}

/** Non-account-scoped adapters for platforms with no login flow (TikTok, Twitch, YouTube). */
export function getStubAdapters(): Record<Exclude<Platform, "instagram">, MessagingAdapter> {
  return { tiktok, twitch, youtube };
}

export function instagramAccountCount(): number {
  return listAccounts("instagram").length;
}

export * from "./types.js";

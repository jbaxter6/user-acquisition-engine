import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets a deploy point this at a mounted persistent volume (e.g.
// Railway) instead of the ephemeral local ../data folder used in dev.
const dataDir = process.env.DATA_DIR ?? path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "inbox.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  -- One row per connected Instagram account (main + satellite accounts),
  -- populated by the OAuth connect flow in routes/auth.ts. Each account is
  -- its own Instagram Business/Creator account with its own access token.
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL DEFAULT 'instagram',
    ig_user_id TEXT NOT NULL,
    username TEXT,
    access_token TEXT NOT NULL,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, ig_user_id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    -- Which of our connected accounts this conversation belongs to.
    -- NULL for platforms with no account concept yet (manual-only TikTok/Twitch entries).
    account_id INTEGER REFERENCES accounts(id),
    external_id TEXT NOT NULL,
    participant_handle TEXT NOT NULL,
    participant_name TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- The same creator could message more than one of our satellite
    -- accounts; each is tracked as its own conversation.
    UNIQUE(platform, account_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'manual', 'webhook')),
    external_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Lightweight migration for a column added after the table already existed
// in deployed databases — CREATE TABLE IF NOT EXISTS above doesn't touch
// existing tables. Safe to run every startup: ignores the "duplicate
// column" error on subsequent runs.
for (const migration of [
  "ALTER TABLE accounts ADD COLUMN profile_picture_url TEXT",
  "ALTER TABLE conversations ADD COLUMN participant_avatar_url TEXT",
]) {
  try {
    db.exec(migration);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("duplicate column")) throw err;
  }
}

export interface AccountRow {
  id: number;
  platform: string;
  ig_user_id: string;
  username: string | null;
  profile_picture_url: string | null;
  access_token: string;
  connected_at: string;
}

export interface ConversationRow {
  id: number;
  platform: string;
  account_id: number | null;
  external_id: string;
  participant_handle: string;
  participant_name: string | null;
  participant_avatar_url: string | null;
  // Only present on the list query in routes/conversations.ts (a preview
  // join), not on rows returned by upsertConversation/getById elsewhere.
  last_message_text?: string;
  last_message_direction?: "inbound" | "outbound";
  status: string;
  last_message_at: string;
  created_at: string;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  direction: "inbound" | "outbound";
  text: string;
  source: "api" | "manual" | "webhook";
  external_message_id: string | null;
  created_at: string;
}

export function listAccounts(platform = "instagram"): AccountRow[] {
  return db
    .prepare<[string], AccountRow>("SELECT * FROM accounts WHERE platform = ? ORDER BY connected_at ASC")
    .all(platform);
}

export function getAccountById(id: number): AccountRow | undefined {
  return db.prepare<[number], AccountRow>("SELECT * FROM accounts WHERE id = ?").get(id);
}

export function getAccountByIgUserId(igUserId: string): AccountRow | undefined {
  return db
    .prepare<[string], AccountRow>("SELECT * FROM accounts WHERE platform = 'instagram' AND ig_user_id = ?")
    .get(igUserId);
}

export function upsertAccount(input: {
  igUserId: string;
  username?: string;
  profilePictureUrl?: string;
  accessToken: string;
}): AccountRow {
  db.prepare(
    `INSERT INTO accounts (platform, ig_user_id, username, profile_picture_url, access_token)
     VALUES ('instagram', ?, ?, ?, ?)
     ON CONFLICT(platform, ig_user_id) DO UPDATE SET
       username = excluded.username,
       profile_picture_url = excluded.profile_picture_url,
       access_token = excluded.access_token`
  ).run(input.igUserId, input.username ?? null, input.profilePictureUrl ?? null, input.accessToken);

  return getAccountByIgUserId(input.igUserId)!;
}

export function deleteAccount(id: number): void {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

export function upsertConversation(
  platform: string,
  externalId: string,
  participantHandle: string,
  participantName?: string,
  accountId?: number
): ConversationRow {
  const existing = db
    .prepare<[string, string, number | null], ConversationRow>(
      "SELECT * FROM conversations WHERE platform = ? AND external_id = ? AND account_id IS ?"
    )
    .get(platform, externalId, accountId ?? null);

  if (existing) return existing;

  const result = db
    .prepare(
      "INSERT INTO conversations (platform, account_id, external_id, participant_handle, participant_name) VALUES (?, ?, ?, ?, ?)"
    )
    .run(platform, accountId ?? null, externalId, participantHandle, participantName ?? null);

  return db
    .prepare<[number], ConversationRow>("SELECT * FROM conversations WHERE id = ?")
    .get(result.lastInsertRowid as number)!;
}

export function updateConversationAvatar(conversationId: number, avatarUrl: string): void {
  db.prepare("UPDATE conversations SET participant_avatar_url = ? WHERE id = ?").run(avatarUrl, conversationId);
}

export function getMessageByExternalId(externalMessageId: string): MessageRow | undefined {
  return db
    .prepare<[string], MessageRow>("SELECT * FROM messages WHERE external_message_id = ?")
    .get(externalMessageId);
}

/** Repairs a message's timestamp — e.g. correcting rows that were backfilled with "now" before Sync tracked real send times. */
export function updateMessageCreatedAt(messageId: number, createdAt: string): void {
  db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(createdAt, messageId);
}

/** Recomputes a conversation's last-activity time from its actual messages, rather than trusting incremental bumps. */
export function recomputeConversationLastMessageAt(conversationId: number): void {
  db.prepare(
    `UPDATE conversations
     SET last_message_at = COALESCE(
       (SELECT MAX(created_at) FROM messages WHERE conversation_id = ?),
       last_message_at
     )
     WHERE id = ?`
  ).run(conversationId, conversationId);
}

export function insertMessage(
  conversationId: number,
  direction: "inbound" | "outbound",
  text: string,
  source: "api" | "manual" | "webhook",
  externalMessageId?: string,
  // When backfilling history (Sync), this should be the message's actual
  // send time, not "now" — otherwise every synced message gets today's
  // timestamp and both the displayed time and ordering (sorted by
  // created_at) come out wrong. Omit for genuinely real-time inserts
  // (webhook, manual, a reply just sent), where "now" is correct.
  createdAt?: string
): MessageRow {
  const result = createdAt
    ? db
        .prepare(
          "INSERT INTO messages (conversation_id, direction, text, source, external_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(conversationId, direction, text, source, externalMessageId ?? null, createdAt)
    : db
        .prepare(
          "INSERT INTO messages (conversation_id, direction, text, source, external_message_id) VALUES (?, ?, ?, ?, ?)"
        )
        .run(conversationId, direction, text, source, externalMessageId ?? null);

  // MAX(a, b) here is SQLite's scalar 2-arg max, not the aggregate — picks
  // the later of the two timestamps as plain zero-padded-text comparison,
  // so backfilling an old message never regresses a conversation's
  // last-activity time past something more recent it already had.
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare("UPDATE conversations SET last_message_at = MAX(last_message_at, ?) WHERE id = ?").run(
    createdAt ?? now,
    conversationId
  );

  return db
    .prepare<[number], MessageRow>("SELECT * FROM messages WHERE id = ?")
    .get(result.lastInsertRowid as number)!;
}

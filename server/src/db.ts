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

  -- Reusable outreach copy, picked from when messaging a prospect, so we
  -- can compare reply rates across different pitches (see
  -- getMessageTemplateStats below). Archiving instead of deleting keeps
  -- past stats/messages.template_id references meaningful.
  CREATE TABLE IF NOT EXISTS message_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT
  );

  -- A separate pipeline from conversations: rows land here from an Excel
  -- import (and, on the roadmap, automated discovery) before anyone has
  -- actually reached out. Only becomes a real conversation once "contacted."
  CREATE TABLE IF NOT EXISTS prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL DEFAULT 'instagram',
    username TEXT NOT NULL,
    display_name TEXT,
    followers INTEGER,
    notes TEXT,
    email TEXT,
    source TEXT NOT NULL DEFAULT 'excel_upload',
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'replied', 'closed')),
    -- Cached once resolved via Business Discovery, so a retry after a
    -- failed send doesn't need to re-resolve the username.
    resolved_ig_user_id TEXT,
    account_id INTEGER REFERENCES accounts(id),
    conversation_id INTEGER REFERENCES conversations(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    contacted_at TEXT,
    UNIQUE(platform, username)
  );
`);

// Lightweight migration for a column added after the table already existed
// in deployed databases — CREATE TABLE IF NOT EXISTS above doesn't touch
// existing tables. Safe to run every startup: ignores the "duplicate
// column" error on subsequent runs.
for (const migration of [
  "ALTER TABLE accounts ADD COLUMN profile_picture_url TEXT",
  "ALTER TABLE conversations ADD COLUMN participant_avatar_url TEXT",
  "ALTER TABLE messages ADD COLUMN template_id INTEGER REFERENCES message_templates(id)",
  `CREATE TABLE IF NOT EXISTS prospect_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    conversation_id INTEGER REFERENCES conversations(id),
    source TEXT NOT NULL DEFAULT 'manual',
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(prospect_id, platform, username)
  )`,
  `CREATE TABLE IF NOT EXISTS prospect_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'instagram',
    handle TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'primary',
    is_primary INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(prospect_id, platform, handle)
  )`,
]) {
  try {
    db.exec(migration);
  } catch (err) {
    if (
      !(err instanceof Error) ||
      (!err.message.includes("duplicate column") &&
        !err.message.includes("already exists"))
    )
      throw err;
  }
}

// One-time cleanup pass (safe on every startup — finds nothing once
// already clean): removes duplicate messages that arose from Sync
// treating a native-app-sent message as "new" each time it saw a
// different id for what was actually the same (conversation, direction,
// text) — see findMessageByContent below, added alongside this to stop
// it from recurring. Keeps the earliest-timestamped copy per duplicate
// group (the historically accurate one), then recomputes every
// conversation's last-activity time, since a phantom "just synced"
// duplicate could have been incorrectly winning that comparison.
try {
  const duplicatesRemoved = db
    .prepare(
      `DELETE FROM messages
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY conversation_id, direction, text
             ORDER BY created_at ASC, id ASC
           ) AS rn
           FROM messages
         )
         WHERE rn = 1
       )`,
    )
    .run().changes;

  if (duplicatesRemoved > 0) {
    console.log(
      `Startup cleanup: removed ${duplicatesRemoved} duplicate message(s).`,
    );
    for (const { id } of db.prepare("SELECT id FROM conversations").all() as {
      id: number;
    }[]) {
      recomputeConversationLastMessageAt(id);
    }
  }
} catch (err) {
  console.error("Duplicate message cleanup failed:", err);
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
  has_engaged?: number;
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
  template_id: number | null;
  created_at: string;
}

export interface MessageTemplateRow {
  id: number;
  name: string;
  body: string;
  created_at: string;
  archived_at: string | null;
}

export interface ProspectRow {
  id: number;
  platform: string;
  username: string;
  display_name: string | null;
  followers: number | null;
  notes: string | null;
  email: string | null;
  source: string;
  status: "new" | "contacted" | "replied" | "closed";
  resolved_ig_user_id: string | null;
  account_id: number | null;
  conversation_id: number | null;
  created_at: string;
  contacted_at: string | null;
}

export interface ProspectChannelRow {
  id: number;
  prospect_id: number;
  platform: string;
  username: string;
  conversation_id: number | null;
  source: string;
  last_seen_at: string;
}

export interface ProspectContactRow {
  id: number;
  prospect_id: number;
  platform: string;
  handle: string;
  name: string | null;
  role: string;
  is_primary: number;
  source: string;
  last_seen_at: string;
}

export interface ProspectInput {
  platform: string;
  username: string;
  displayName?: string;
  followers?: number;
  notes?: string;
  email?: string;
  source?: string;
}

export function listProspects(
  filters: { platform?: string; status?: string } = {},
): ProspectRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.platform) {
    clauses.push("platform = ?");
    params.push(filters.platform);
  }
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare<
      string[],
      ProspectRow
    >(`SELECT * FROM prospects ${where} ORDER BY created_at DESC`)
    .all(...params);
}

export function getProspectById(id: number): ProspectRow | undefined {
  return db
    .prepare<[number], ProspectRow>("SELECT * FROM prospects WHERE id = ?")
    .get(id);
}

export function getProspectByUsername(
  platform: string,
  username: string,
): ProspectRow | undefined {
  const normalized = username.trim().replace(/^@/, "");
  return db
    .prepare<
      [string, string],
      ProspectRow
    >("SELECT * FROM prospects WHERE platform = ? AND LOWER(username) = LOWER(?) LIMIT 1")
    .get(platform, normalized);
}

export function listProspectContacts(prospectId: number): ProspectContactRow[] {
  return db
    .prepare<
      [number],
      ProspectContactRow
    >("SELECT * FROM prospect_contacts WHERE prospect_id = ? ORDER BY is_primary DESC, last_seen_at DESC, id ASC")
    .all(prospectId);
}

export function upsertProspectContact(
  prospectId: number,
  input: {
    platform: string;
    handle: string;
    name?: string | null;
    role?: string;
    source?: string;
    isPrimary?: boolean;
  },
): ProspectContactRow {
  const handle = input.handle.trim().replace(/^@/, "");
  if (!handle) throw new Error("contact handle is required");

  const result = db
    .prepare(
      `INSERT INTO prospect_contacts (prospect_id, platform, handle, name, role, is_primary, source, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(prospect_id, platform, handle) DO UPDATE SET
         name = excluded.name,
         role = excluded.role,
         is_primary = excluded.is_primary,
         source = excluded.source,
         last_seen_at = datetime('now')`,
    )
    .run(
      prospectId,
      input.platform,
      handle,
      input.name ?? null,
      input.role ?? "primary",
      input.isPrimary ? 1 : 0,
      input.source ?? "manual",
    );

  return (
    db
      .prepare<
        [number],
        ProspectContactRow
      >("SELECT * FROM prospect_contacts WHERE id = ?")
      .get(result.lastInsertRowid as number) ??
    db
      .prepare<
        [number, string, string],
        ProspectContactRow
      >("SELECT * FROM prospect_contacts WHERE prospect_id = ? AND platform = ? AND handle = ? LIMIT 1")
      .get(prospectId, input.platform, handle)!
  );
}

export function ensureProspectForParticipant(input: {
  platform: string;
  handle: string;
  name?: string | null;
  source?: string;
  role?: string;
  conversationId?: number | null;
}): ProspectRow {
  const platform = input.platform.toLowerCase();
  const handle = input.handle.trim().replace(/^@/, "");
  if (!handle) throw new Error("participant handle is required");

  let prospect = getProspectByUsername(platform, handle);
  if (!prospect) {
    const result = db
      .prepare(
        "INSERT INTO prospects (platform, username, display_name, source, status, notes) VALUES (?, ?, ?, ?, 'replied', ?)",
      )
      .run(
        platform,
        handle,
        input.name ?? null,
        input.source ?? "inbound_message",
        "Auto-created from inbound message",
      );
    prospect = getProspectById(result.lastInsertRowid as number)!;
  } else if (input.name && !prospect.display_name) {
    db.prepare("UPDATE prospects SET display_name = ? WHERE id = ?").run(
      input.name,
      prospect.id,
    );
  }

  if (prospect.status === "new" || prospect.status === "contacted") {
    db.prepare("UPDATE prospects SET status = 'replied' WHERE id = ?").run(
      prospect.id,
    );
  }

  attachProspectChannel(
    prospect.id,
    platform,
    handle,
    input.conversationId ?? null,
  );
  upsertProspectContact(prospect.id, {
    platform,
    handle,
    name: input.name ?? null,
    role: input.role ?? "primary",
    source: input.source ?? "inbound_message",
    isPrimary: true,
  });

  return getProspectById(prospect.id)!;
}

export function listProspectChannels(prospectId: number): ProspectChannelRow[] {
  return db
    .prepare<
      [number],
      ProspectChannelRow
    >("SELECT * FROM prospect_channels WHERE prospect_id = ? ORDER BY last_seen_at DESC, platform ASC")
    .all(prospectId);
}

export function upsertProspectChannel(
  prospectId: number,
  input: {
    platform: string;
    username: string;
    conversationId?: number | null;
    source?: string;
  },
): ProspectChannelRow {
  const username = input.username.trim().replace(/^@/, "");
  if (!username) throw new Error("channel username is required");

  const result = db
    .prepare(
      `INSERT INTO prospect_channels (prospect_id, platform, username, conversation_id, source, last_seen_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(prospect_id, platform, username) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         source = excluded.source,
         last_seen_at = datetime('now')`,
    )
    .run(
      prospectId,
      input.platform.toLowerCase(),
      username,
      input.conversationId ?? null,
      input.source ?? "manual",
    );

  return (
    db
      .prepare<
        [number],
        ProspectChannelRow
      >("SELECT * FROM prospect_channels WHERE id = ?")
      .get(result.lastInsertRowid as number) ??
    db
      .prepare<
        [number, string, string],
        ProspectChannelRow
      >("SELECT * FROM prospect_channels WHERE prospect_id = ? AND platform = ? AND username = ? LIMIT 1")
      .get(prospectId, input.platform.toLowerCase(), username)!
  );
}

export function attachProspectChannel(
  prospectId: number,
  platform: string,
  username: string,
  conversationId?: number | null,
): void {
  upsertProspectChannel(prospectId, {
    platform,
    username,
    conversationId: conversationId ?? null,
    source: "conversation",
  });
}

export function mergeProspectIntoTarget(
  sourceId: number,
  targetId: number,
): ProspectRow {
  if (sourceId === targetId) {
    return getProspectById(targetId)!;
  }

  const source = getProspectById(sourceId);
  const target = getProspectById(targetId);
  if (!source || !target) throw new Error("prospect not found");

  for (const row of db
    .prepare<
      [number],
      ProspectChannelRow
    >("SELECT * FROM prospect_channels WHERE prospect_id = ?")
    .all(sourceId)) {
    const channelRecord = db
      .prepare<
        [number, string, string],
        ProspectChannelRow
      >("SELECT * FROM prospect_channels WHERE prospect_id = ? AND platform = ? AND username = ? LIMIT 1")
      .get(targetId, row.platform, row.username);

    if (channelRecord) {
      const nextConversationId =
        channelRecord.conversation_id ?? row.conversation_id;
      db.prepare(
        `UPDATE prospect_channels
         SET conversation_id = ?, source = ?, last_seen_at = CASE
           WHEN datetime(?) > datetime(last_seen_at) THEN ?
           ELSE last_seen_at
         END
         WHERE id = ?`,
      ).run(
        nextConversationId,
        row.source,
        row.last_seen_at,
        row.last_seen_at,
        channelRecord.id,
      );
    } else {
      db.prepare(
        `INSERT INTO prospect_channels (prospect_id, platform, username, conversation_id, source, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        targetId,
        row.platform,
        row.username,
        row.conversation_id,
        row.source,
        row.last_seen_at,
      );
    }
  }

  for (const row of db
    .prepare<
      [number],
      ProspectContactRow
    >("SELECT * FROM prospect_contacts WHERE prospect_id = ?")
    .all(sourceId)) {
    const existing = db
      .prepare<
        [number, string, string],
        ProspectContactRow
      >("SELECT * FROM prospect_contacts WHERE prospect_id = ? AND platform = ? AND handle = ? LIMIT 1")
      .get(targetId, row.platform, row.handle);

    if (existing) {
      db.prepare(
        `UPDATE prospect_contacts
         SET name = COALESCE(?, name),
             role = COALESCE(?, role),
             is_primary = MAX(is_primary, ?),
             source = ?,
             last_seen_at = CASE
               WHEN datetime(?) > datetime(last_seen_at) THEN ?
               ELSE last_seen_at
             END
         WHERE id = ?`,
      ).run(
        row.name ?? existing.name,
        row.role ?? existing.role,
        row.is_primary,
        row.source,
        row.last_seen_at,
        row.last_seen_at,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO prospect_contacts (prospect_id, platform, handle, name, role, is_primary, source, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        targetId,
        row.platform,
        row.handle,
        row.name,
        row.role,
        row.is_primary,
        row.source,
        row.last_seen_at,
      );
    }
  }

  db.prepare(
    `UPDATE prospects
     SET status = CASE WHEN status = 'replied' OR ? = 'replied' THEN 'replied' WHEN status = 'contacted' OR ? = 'contacted' THEN 'contacted' ELSE 'new' END,
         account_id = COALESCE(account_id, ?),
         conversation_id = COALESCE(conversation_id, ?),
         contacted_at = COALESCE(contacted_at, ?),
         display_name = COALESCE(NULLIF(display_name, ''), ?),
         notes = COALESCE(NULLIF(notes, ''), ?)
     WHERE id = ?`,
  ).run(
    source.status,
    source.status,
    source.account_id,
    source.conversation_id,
    source.contacted_at,
    source.display_name,
    source.notes,
    targetId,
  );

  db.prepare("DELETE FROM prospects WHERE id = ?").run(sourceId);
  return getProspectById(targetId)!;
}

export function bulkInsertProspects(prospects: ProspectInput[]): number {
  const insert = db.prepare(
    `INSERT INTO prospects (platform, username, display_name, followers, notes, email, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform, username) DO NOTHING`,
  );
  const insertAll = db.transaction((rows: ProspectInput[]) => {
    let inserted = 0;
    for (const p of rows) {
      const result = insert.run(
        p.platform,
        p.username,
        p.displayName ?? null,
        p.followers ?? null,
        p.notes ?? null,
        p.email ?? null,
        p.source ?? "excel_upload",
      );
      if (result.changes > 0) {
        inserted++;
        const prospect = getProspectByUsername(p.platform, p.username);
        if (prospect) {
          attachProspectChannel(
            prospect.id,
            prospect.platform,
            prospect.username,
            prospect.conversation_id ?? null,
          );
        }
      }
    }
    return inserted;
  });
  return insertAll(prospects);
}

export function deleteProspect(id: number): void {
  db.prepare("DELETE FROM prospects WHERE id = ?").run(id);
}

export function setProspectResolvedId(id: number, igUserId: string): void {
  db.prepare("UPDATE prospects SET resolved_ig_user_id = ? WHERE id = ?").run(
    igUserId,
    id,
  );
}

export function markProspectContacted(
  id: number,
  accountId: number | null,
  conversationId: number,
): void {
  db.prepare(
    "UPDATE prospects SET status = 'contacted', account_id = ?, conversation_id = ?, contacted_at = datetime('now') WHERE id = ?",
  ).run(accountId, conversationId, id);
}

export function listAccounts(platform = "instagram"): AccountRow[] {
  return db
    .prepare<
      [string],
      AccountRow
    >("SELECT * FROM accounts WHERE platform = ? ORDER BY connected_at ASC")
    .all(platform);
}

export function getAccountById(id: number): AccountRow | undefined {
  return db
    .prepare<[number], AccountRow>("SELECT * FROM accounts WHERE id = ?")
    .get(id);
}

export function getAccountByIgUserId(igUserId: string): AccountRow | undefined {
  return db
    .prepare<
      [string],
      AccountRow
    >("SELECT * FROM accounts WHERE platform = 'instagram' AND ig_user_id = ?")
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
       access_token = excluded.access_token`,
  ).run(
    input.igUserId,
    input.username ?? null,
    input.profilePictureUrl ?? null,
    input.accessToken,
  );

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
  accountId?: number,
): ConversationRow {
  const existing = db
    .prepare<
      [string, string, number | null],
      ConversationRow
    >("SELECT * FROM conversations WHERE platform = ? AND external_id = ? AND account_id IS ?")
    .get(platform, externalId, accountId ?? null);

  if (existing) return existing;

  const result = db
    .prepare(
      "INSERT INTO conversations (platform, account_id, external_id, participant_handle, participant_name) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      platform,
      accountId ?? null,
      externalId,
      participantHandle,
      participantName ?? null,
    );

  return db
    .prepare<
      [number],
      ConversationRow
    >("SELECT * FROM conversations WHERE id = ?")
    .get(result.lastInsertRowid as number)!;
}

export function updateConversationAvatar(
  conversationId: number,
  avatarUrl: string,
): void {
  db.prepare(
    "UPDATE conversations SET participant_avatar_url = ? WHERE id = ?",
  ).run(avatarUrl, conversationId);
}

export function conversationHasInboundMessage(conversationId: number): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM messages WHERE conversation_id = ? AND direction = 'inbound' LIMIT 1",
    )
    .get(conversationId);
}

export function getMessageByExternalId(
  externalMessageId: string,
): MessageRow | undefined {
  return db
    .prepare<
      [string],
      MessageRow
    >("SELECT * FROM messages WHERE external_message_id = ?")
    .get(externalMessageId);
}

export function findMessageByContent(
  conversationId: number,
  direction: "inbound" | "outbound",
  text: string,
): MessageRow | undefined {
  return db
    .prepare<
      [number, string, string],
      MessageRow
    >("SELECT * FROM messages WHERE conversation_id = ? AND direction = ? AND text = ? ORDER BY created_at ASC, id ASC LIMIT 1")
    .get(conversationId, direction, text);
}

export function updateMessageCreatedAt(
  messageId: number,
  createdAt: string,
): void {
  db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(
    createdAt,
    messageId,
  );
}

export function recomputeConversationLastMessageAt(
  conversationId: number,
): void {
  db.prepare(
    `UPDATE conversations
     SET last_message_at = COALESCE(
       (SELECT MAX(created_at) FROM messages WHERE conversation_id = ?),
       last_message_at
     )
     WHERE id = ?`,
  ).run(conversationId, conversationId);
}

export function insertMessage(
  conversationId: number,
  direction: "inbound" | "outbound",
  text: string,
  source: "api" | "manual" | "webhook",
  externalMessageId?: string,
  createdAt?: string,
  templateId?: number,
): MessageRow {
  const result = createdAt
    ? db
        .prepare(
          "INSERT INTO messages (conversation_id, direction, text, source, external_message_id, created_at, template_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          conversationId,
          direction,
          text,
          source,
          externalMessageId ?? null,
          createdAt,
          templateId ?? null,
        )
    : db
        .prepare(
          "INSERT INTO messages (conversation_id, direction, text, source, external_message_id, template_id) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          conversationId,
          direction,
          text,
          source,
          externalMessageId ?? null,
          templateId ?? null,
        );

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare(
    "UPDATE conversations SET last_message_at = MAX(last_message_at, ?) WHERE id = ?",
  ).run(createdAt ?? now, conversationId);

  return db
    .prepare<[number], MessageRow>("SELECT * FROM messages WHERE id = ?")
    .get(result.lastInsertRowid as number)!;
}

export function listMessageTemplates(
  includeArchived = false,
): MessageTemplateRow[] {
  const where = includeArchived ? "" : "WHERE archived_at IS NULL";
  return db
    .prepare<
      [],
      MessageTemplateRow
    >(`SELECT * FROM message_templates ${where} ORDER BY created_at DESC`)
    .all();
}

export function getMessageTemplateById(
  id: number,
): MessageTemplateRow | undefined {
  return db
    .prepare<
      [number],
      MessageTemplateRow
    >("SELECT * FROM message_templates WHERE id = ?")
    .get(id);
}

export function createMessageTemplate(
  name: string,
  body: string,
): MessageTemplateRow {
  const result = db
    .prepare("INSERT INTO message_templates (name, body) VALUES (?, ?)")
    .run(name, body);
  return getMessageTemplateById(result.lastInsertRowid as number)!;
}

export function updateMessageTemplate(
  id: number,
  name: string,
  body: string,
): MessageTemplateRow | undefined {
  db.prepare(
    "UPDATE message_templates SET name = ?, body = ? WHERE id = ?",
  ).run(name, body, id);
  return getMessageTemplateById(id);
}

export function archiveMessageTemplate(id: number): void {
  db.prepare(
    "UPDATE message_templates SET archived_at = datetime('now') WHERE id = ?",
  ).run(id);
}

export interface MessageTemplateStats {
  id: number;
  name: string;
  body: string;
  archived_at: string | null;
  sent: number;
  replied: number;
  reply_rate: number;
}

export function getMessageTemplateStats(): MessageTemplateStats[] {
  return db
    .prepare<[], MessageTemplateStats>(
      `SELECT
         t.id,
         t.name,
         t.body,
         t.archived_at,
         COUNT(m.id) AS sent,
         COUNT(DISTINCT CASE WHEN EXISTS (
           SELECT 1 FROM messages reply
           WHERE reply.conversation_id = m.conversation_id AND reply.direction = 'inbound'
         ) THEN m.conversation_id END) AS replied
       FROM message_templates t
       LEFT JOIN messages m ON m.template_id = t.id AND m.direction = 'outbound'
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
    )
    .all()
    .map((row) => ({
      ...row,
      reply_rate: row.sent > 0 ? row.replied / row.sent : 0,
    }));
}

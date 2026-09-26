import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Platform } from "./adapters/types.js";
import type { Criterion } from "./profiles/attributes.js";
import type { MetaCallKind, MetaUsageReading } from "./meta/usage.js";

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
  // Set when Meta rejects the token (error 190); cleared on reconnect.
  "ALTER TABLE accounts ADD COLUMN token_invalid_at TEXT",
  // Disconnect is a soft delete: conversations and prospects reference the
  // account (foreign keys), and reconnecting the same Instagram account
  // should bring its threads back. See deleteAccount.
  "ALTER TABLE accounts ADD COLUMN disconnected_at TEXT",
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
  // Ties two independently-existing prospect cards together (e.g. an
  // Instagram card and that same person's TikTok card) without merging
  // them — each stays visible/messageable on its own. Stored as a row in
  // each direction so either side can list its links with a single query.
  `CREATE TABLE IF NOT EXISTS prospect_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    linked_prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL DEFAULT 'linked',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(prospect_id, linked_prospect_id)
  )`,
  // Target profiles ("Profiles" in the UI): saved per-platform criteria
  // describing who we want to reach. Named target_* because "profile"
  // already means a social account's own profile elsewhere in this
  // codebase. criteria_json is validated against the attribute registry
  // (profiles/attributes.ts) on every write. See docs/profiles-architecture.md.
  `CREATE TABLE IF NOT EXISTS target_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    platform TEXT NOT NULL,
    criteria_json TEXT NOT NULL DEFAULT '[]',
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT
  )`,
  // Observed facts about a prospect (following count, verified, links…),
  // keyed by the attribute registry (profiles/attributes.ts) so every source
  // — spreadsheet import, scraper, later the messaging API — writes one
  // place and the matcher reads one place. Latest value per attribute;
  // source + observed_at say where/when it came from.
  `CREATE TABLE IF NOT EXISTS prospect_attributes (
    prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    attribute TEXT NOT NULL,
    value_json TEXT NOT NULL,
    source TEXT NOT NULL,
    observed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (prospect_id, attribute)
  )`,
  // Every call made to Meta, via meta/metaFetch.ts — feeds the navbar
  // usage meter (docs/meta-api-usage-meter.md). account_id is null for
  // OAuth calls made before the account row exists.
  `CREATE TABLE IF NOT EXISTS meta_api_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    kind TEXT NOT NULL,
    status INTEGER NOT NULL,
    throttled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS meta_api_calls_account_time ON meta_api_calls(account_id, created_at)",
  // Latest utilization Meta reported for each account, plus what the last
  // Sync cost. One row per account.
  `CREATE TABLE IF NOT EXISTS meta_api_usage (
    account_id INTEGER PRIMARY KEY,
    call_count_pct REAL,
    total_time_pct REAL,
    total_cputime_pct REAL,
    regain_access_minutes INTEGER,
    updated_at TEXT,
    last_sync_calls INTEGER,
    last_sync_at TEXT
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

// One-time migration (safe every startup): linkProspectManager originally
// tagged the reverse direction of a manager/rep link as a plain "linked",
// indistinguishable from a real tied social profile. Rewrites any such row
// to "managed_by:<role>" so it surfaces under "Other Connections" instead —
// matches nothing once already migrated.
try {
  db.prepare(
    `UPDATE prospect_links
     SET relationship = 'managed_by:' || (
       SELECT rev.relationship FROM prospect_links rev
       WHERE rev.prospect_id = prospect_links.linked_prospect_id
         AND rev.linked_prospect_id = prospect_links.prospect_id
     )
     WHERE relationship = 'linked'
       AND EXISTS (
         SELECT 1 FROM prospect_links rev
         WHERE rev.prospect_id = prospect_links.linked_prospect_id
           AND rev.linked_prospect_id = prospect_links.prospect_id
           AND rev.relationship IN ('manager', 'agent', 'assistant', 'owner', 'primary', 'other')
       )`,
  ).run();
} catch (err) {
  console.error("Manager-link reverse-relationship migration failed:", err);
}

// One-time cleanup (safe every startup): older auto-created prospects got a
// boilerplate note that showed up on their cards; clear it.
try {
  db.prepare(
    "UPDATE prospects SET notes = NULL WHERE notes IN ('Auto-created from outbound message', 'Auto-created from inbound message')",
  ).run();
} catch (err) {
  console.error("Auto-created note cleanup failed:", err);
}

// contacted_at should be when the first message actually went out, not when
// Sync first noticed it. Sets it from each linked thread's earliest outbound
// message (all threads when no id is given). Safe to re-run.
export function syncProspectContactedAt(conversationId?: number): void {
  db.prepare(
    `UPDATE prospects
     SET contacted_at = (
       SELECT MIN(m.created_at) FROM messages m
       WHERE m.conversation_id = prospects.conversation_id AND m.direction = 'outbound'
     )
     WHERE conversation_id IS NOT NULL
       ${conversationId != null ? "AND conversation_id = ?" : ""}
       AND EXISTS (
         SELECT 1 FROM messages m
         WHERE m.conversation_id = prospects.conversation_id AND m.direction = 'outbound'
       )`,
  ).run(...(conversationId != null ? [conversationId] : []));
}

try {
  syncProspectContactedAt();
} catch (err) {
  console.error("contacted_at backfill failed:", err);
}

export interface AccountRow {
  id: number;
  platform: string;
  ig_user_id: string;
  username: string | null;
  profile_picture_url: string | null;
  access_token: string;
  connected_at: string;
  token_invalid_at: string | null;
  disconnected_at: string | null;
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
  // Already validated against the registry (routes/prospects.ts).
  attributes?: Record<string, unknown>;
}

export interface ProspectAttributeValue {
  value: unknown;
  source: string;
  observed_at: string;
}

export function listProspectAttributes(
  prospectId: number,
): Record<string, ProspectAttributeValue> {
  const rows = db
    .prepare<
      [number],
      { attribute: string; value_json: string; source: string; observed_at: string }
    >("SELECT attribute, value_json, source, observed_at FROM prospect_attributes WHERE prospect_id = ?")
    .all(prospectId);
  return Object.fromEntries(
    rows.map((r) => [
      r.attribute,
      { value: JSON.parse(r.value_json), source: r.source, observed_at: r.observed_at },
    ]),
  );
}

// Latest observation wins: re-importing a fresher sheet updates values.
export function upsertProspectAttributes(
  prospectId: number,
  attributes: Record<string, unknown>,
  source: string,
): number {
  const stmt = db.prepare(
    `INSERT INTO prospect_attributes (prospect_id, attribute, value_json, source, observed_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(prospect_id, attribute) DO UPDATE SET
       value_json = excluded.value_json,
       source = excluded.source,
       observed_at = excluded.observed_at`,
  );
  let n = 0;
  for (const [key, value] of Object.entries(attributes)) {
    stmt.run(prospectId, key, JSON.stringify(value), source);
    n++;
  }
  return n;
}

export type ProspectSort = "recent" | "newest" | "name";

export interface ProspectFilters {
  platform?: string;
  status?: string;
  q?: string;
}

function prospectWhere(filters: ProspectFilters): {
  where: string;
  params: string[];
} {
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
  const q = filters.q?.trim().replace(/^@/, "");
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      "(username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

// Just platform + username for every prospect — lets the local scraper skip
// people we already have without paging through full prospect rows.
export function listProspectHandles(): { platform: string; username: string }[] {
  return db
    .prepare<[], { platform: string; username: string }>(
      "SELECT platform, username FROM prospects",
    )
    .all();
}

const PROSPECT_ORDER: Record<ProspectSort, string> = {
  recent: "COALESCE(contacted_at, created_at) DESC, id DESC",
  newest: "created_at DESC, id DESC",
  name: "LOWER(COALESCE(NULLIF(display_name, ''), username)) ASC, id ASC",
};

export function listProspects(
  filters: ProspectFilters & {
    sort?: ProspectSort;
    limit?: number;
    offset?: number;
  } = {},
): { items: ProspectRow[]; total: number } {
  const { where, params } = prospectWhere(filters);
  const order = PROSPECT_ORDER[filters.sort ?? "recent"] ?? PROSPECT_ORDER.recent;
  const limit = Math.min(Math.max(filters.limit ?? 24, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const items = db
    .prepare<
      (string | number)[],
      ProspectRow
    >(`SELECT * FROM prospects ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const { total } = db
    .prepare<
      string[],
      { total: number }
    >(`SELECT COUNT(*) AS total FROM prospects ${where}`)
    .get(...params)!;
  return { items, total };
}

// Per-status counts for the filter pills. Honors platform/search but
// deliberately ignores the status filter so every pill shows its own count.
export function countProspectsByStatus(
  filters: Omit<ProspectFilters, "status"> = {},
): Record<"all" | "new" | "contacted" | "replied" | "closed", number> {
  const { where, params } = prospectWhere(filters);
  const rows = db
    .prepare<
      string[],
      { status: string; n: number }
    >(`SELECT status, COUNT(*) AS n FROM prospects ${where} GROUP BY status`)
    .all(...params);
  const counts = { all: 0, new: 0, contacted: 0, replied: 0, closed: 0 };
  for (const { status, n } of rows) {
    if (status in counts) counts[status as keyof typeof counts] = n;
    counts.all += n;
  }
  return counts;
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
  accountId?: number | null;
  // "outbound" = we messaged them and they haven't necessarily replied:
  // creates/keeps the prospect as "contacted" instead of "replied".
  direction?: "inbound" | "outbound";
}): ProspectRow {
  const platform = input.platform.toLowerCase();
  const handle = input.handle.trim().replace(/^@/, "");
  if (!handle) throw new Error("participant handle is required");
  const outbound = input.direction === "outbound";
  const status = outbound ? "contacted" : "replied";

  let prospect = getProspectByUsername(platform, handle);
  if (!prospect) {
    const result = db
      .prepare(
        "INSERT INTO prospects (platform, username, display_name, source, status, notes) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        platform,
        handle,
        input.name ?? null,
        input.source ?? (outbound ? "outbound_message" : "inbound_message"),
        status,
        null,
      );
    prospect = getProspectById(result.lastInsertRowid as number)!;
  } else if (input.name && !prospect.display_name) {
    db.prepare("UPDATE prospects SET display_name = ? WHERE id = ?").run(
      input.name,
      prospect.id,
    );
  }

  if (outbound) {
    if (prospect.status === "new") {
      db.prepare(
        "UPDATE prospects SET status = 'contacted' WHERE id = ?",
      ).run(prospect.id);
    }
  } else if (prospect.status === "new" || prospect.status === "contacted") {
    db.prepare("UPDATE prospects SET status = 'replied' WHERE id = ?").run(
      prospect.id,
    );
  }

  if (input.conversationId != null) {
    db.prepare(
      `UPDATE prospects
       SET conversation_id = COALESCE(conversation_id, ?),
           account_id = COALESCE(account_id, ?),
           contacted_at = COALESCE(contacted_at, datetime('now'))
       WHERE id = ?`,
    ).run(input.conversationId, input.accountId ?? null, prospect.id);
  }

  attachProspectChannel(
    prospect.id,
    platform,
    handle,
    input.conversationId ?? null,
  );
  if (!outbound) {
    upsertProspectContact(prospect.id, {
      platform,
      handle,
      name: input.name ?? null,
      role: input.role ?? "primary",
      source: input.source ?? "inbound_message",
      isPrimary: true,
    });
  }

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

export interface ProspectLinkRow {
  id: number;
  platform: string;
  username: string;
  display_name: string | null;
  status: string;
  followers: number | null;
  relationship: string;
}

export function listProspectLinks(prospectId: number): ProspectLinkRow[] {
  return db
    .prepare<
      [number],
      ProspectLinkRow
    >(
      `SELECT p.id, p.platform, p.username, p.display_name, p.status, p.followers, pl.relationship
       FROM prospect_links pl
       JOIN prospects p ON p.id = pl.linked_prospect_id
       WHERE pl.prospect_id = ?
       ORDER BY p.username ASC`,
    )
    .all(prospectId);
}

// Ties two prospect cards together as a relationship, not a merge — both
// stay independently viewable/messageable. Stored in both directions so
// either card's links can be read with a single query. `relationship`
// labels the aId -> bId direction (e.g. "linked" for a tied social profile,
// or a role like "manager" when bId represents a's manager); the reverse
// defaults to a plain "linked" since b isn't necessarily a's own role-holder.
export function linkProspects(
  aId: number,
  bId: number,
  relationship = "linked",
  reverseRelationship: string = relationship,
): void {
  if (aId === bId) return;
  const insert = db.prepare(
    `INSERT INTO prospect_links (prospect_id, linked_prospect_id, relationship)
     VALUES (?, ?, ?)
     ON CONFLICT(prospect_id, linked_prospect_id) DO UPDATE SET relationship = excluded.relationship`,
  );
  insert.run(aId, bId, relationship);
  insert.run(bId, aId, reverseRelationship);
}

export function unlinkProspects(aId: number, bId: number): void {
  db.prepare(
    "DELETE FROM prospect_links WHERE (prospect_id = ? AND linked_prospect_id = ?) OR (prospect_id = ? AND linked_prospect_id = ?)",
  ).run(aId, bId, bId, aId);
}

// Shared by linkProspectChannel/linkProspectManager: finds the prospect
// card for a platform+username, creating a bare one first if it doesn't
// exist yet — either way the two cards stay separate, just
// cross-referenced via prospect_links.
function resolveOrCreateLinkTarget(
  target: ProspectRow,
  platform: string,
  username: string,
): ProspectRow {
  const normalizedPlatform = platform.trim().toLowerCase();
  const normalizedUsername = username.trim().replace(/^@/, "");
  if (!normalizedPlatform) throw new Error("platform is required");
  if (!normalizedUsername) throw new Error("username is required");

  if (
    normalizedPlatform === target.platform &&
    normalizedUsername.toLowerCase() === target.username.toLowerCase()
  ) {
    throw new Error("that's this prospect's own account");
  }

  let other = getProspectByUsername(normalizedPlatform, normalizedUsername);
  if (other && other.id === target.id) {
    throw new Error("that's this prospect's own account");
  }

  if (!other) {
    const result = db
      .prepare(
        "INSERT INTO prospects (platform, username, source, status) VALUES (?, ?, 'manual_link', 'new')",
      )
      .run(normalizedPlatform, normalizedUsername);
    other = getProspectById(result.lastInsertRowid as number)!;
  }

  return other;
}

// Ties another platform/username to an existing prospect card as a "tied
// social profile" (relationship = "linked" both directions).
export function linkProspectChannel(
  prospectId: number,
  platform: string,
  username: string,
): ProspectRow {
  const target = getProspectById(prospectId);
  if (!target) throw new Error("prospect not found");

  const other = resolveOrCreateLinkTarget(target, platform, username);
  linkProspects(prospectId, other.id);
  return getProspectById(prospectId)!;
}

// Role labels linkProspectManager accepts — also used to tell a "connected
// manager/rep" link apart from a plain "linked" tied social profile.
export const MANAGER_ROLES = ["manager", "agent", "assistant", "owner", "primary", "other"];

// Ties another platform/username to an existing prospect card as a
// "connected manager/rep" — same non-destructive linkage, but labeled with
// a role from this prospect's side. The reverse direction is tagged
// "managed_by:<role>" (instead of a plain "linked") so the other card can
// surface it under its own "Other Connections" section rather than
// mistaking it for a tied social profile.
export function linkProspectManager(
  prospectId: number,
  platform: string,
  username: string,
  role: string,
): ProspectRow {
  const target = getProspectById(prospectId);
  if (!target) throw new Error("prospect not found");

  const other = resolveOrCreateLinkTarget(target, platform, username);
  const normalizedRole = MANAGER_ROLES.includes(role.trim()) ? role.trim() : "manager";
  linkProspects(prospectId, other.id, normalizedRole, `managed_by:${normalizedRole}`);
  return getProspectById(prospectId)!;
}

// Inserts new prospects (existing handles are left as-is) and records any
// attributes on both new and existing ones — so re-importing a fresher
// scraper sheet refreshes the numbers without touching manual edits to the
// prospect itself.
export function bulkInsertProspects(prospects: ProspectInput[]): {
  inserted: number;
  enriched: number;
} {
  const insert = db.prepare(
    `INSERT INTO prospects (platform, username, display_name, followers, notes, email, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform, username) DO NOTHING`,
  );
  const insertAll = db.transaction((rows: ProspectInput[]) => {
    let inserted = 0;
    let enriched = 0;
    for (const p of rows) {
      const source = p.source ?? "excel_upload";
      const result = insert.run(
        p.platform,
        p.username,
        p.displayName ?? null,
        p.followers ?? null,
        p.notes ?? null,
        p.email ?? null,
        source,
      );
      const prospect = getProspectByUsername(p.platform, p.username);
      if (!prospect) continue;
      if (result.changes > 0) {
        inserted++;
        attachProspectChannel(
          prospect.id,
          prospect.platform,
          prospect.username,
          prospect.conversation_id ?? null,
        );
      }
      if (p.attributes && Object.keys(p.attributes).length) {
        upsertProspectAttributes(prospect.id, p.attributes, source);
        if (result.changes === 0) enriched++;
      }
    }
    return { inserted, enriched };
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
    >("SELECT * FROM accounts WHERE platform = ? AND disconnected_at IS NULL ORDER BY connected_at ASC")
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
  platform?: string;
}): AccountRow {
  const platform = input.platform ?? "instagram";
  db.prepare(
    `INSERT INTO accounts (platform, ig_user_id, username, profile_picture_url, access_token)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(platform, ig_user_id) DO UPDATE SET
       username = excluded.username,
       profile_picture_url = excluded.profile_picture_url,
       access_token = excluded.access_token,
       disconnected_at = NULL,
       token_invalid_at = CASE
         WHEN excluded.access_token = accounts.access_token THEN accounts.token_invalid_at
         ELSE NULL
       END`,
  ).run(
    platform,
    input.igUserId,
    input.username ?? null,
    input.profilePictureUrl ?? null,
    input.accessToken,
  );

  return db
    .prepare<
      [string, string],
      AccountRow
    >("SELECT * FROM accounts WHERE platform = ? AND ig_user_id = ?")
    .get(platform, input.igUserId)!;
}

export function markAccountTokenInvalid(id: number): void {
  db.prepare(
    "UPDATE accounts SET token_invalid_at = datetime('now') WHERE id = ? AND token_invalid_at IS NULL",
  ).run(id);
}

/**
 * Disconnects an account: hides it and wipes its token, but keeps the row so
 * its conversations/prospects (which reference it) survive. Reconnecting the
 * same Instagram account (upsertAccount) brings it back with its threads.
 */
export function deleteAccount(id: number): void {
  db.prepare(
    "UPDATE accounts SET disconnected_at = datetime('now'), access_token = '' WHERE id = ?",
  ).run(id);
}

/** A connected (not disconnected) account, or undefined. */
export function getActiveAccountById(id: number): AccountRow | undefined {
  const account = getAccountById(id);
  return account && !account.disconnected_at ? account : undefined;
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

// Finds an existing conversation by platform + participant handle, across
// every connected account — used to catch a prospect who already has a
// real inbox thread (e.g. synced from a webhook, keyed by their resolved
// platform ID) before a cold-outreach flow would otherwise create a
// separate, un-synced conversation keyed by their raw username.
export function findConversationByHandle(
  platform: string,
  handle: string,
): ConversationRow | undefined {
  const normalized = handle.trim().replace(/^@/, "");
  return db
    .prepare<
      [string, string],
      ConversationRow
    >(
      `SELECT * FROM conversations
       WHERE platform = ? AND LOWER(participant_handle) = LOWER(?)
       ORDER BY last_message_at DESC
       LIMIT 1`,
    )
    .get(platform, normalized);
}

// Every thread with this person — one per connected account that has talked
// to them — oldest first. A prospect can be messaged from several accounts.
export function listConversationsByHandle(
  platform: string,
  handle: string,
): ConversationRow[] {
  const normalized = handle.trim().replace(/^@/, "");
  return db
    .prepare<
      [string, string],
      ConversationRow
    >(
      `SELECT * FROM conversations
       WHERE platform = ? AND LOWER(participant_handle) = LOWER(?)
       ORDER BY created_at ASC, id ASC`,
    )
    .all(platform, normalized);
}

// What the inbox shows for a participant's avatar: the stored photo URL and
// whether they've ever messaged us (Meta withholds the photo until they do).
export function getConversationAvatarInfo(
  conversationId: number,
): { avatar_url: string | null; has_engaged: boolean } | undefined {
  const row = db
    .prepare<
      [number],
      { avatar_url: string | null; has_engaged: number }
    >(
      `SELECT c.participant_avatar_url AS avatar_url,
              EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS has_engaged
       FROM conversations c WHERE c.id = ?`,
    )
    .get(conversationId);
  return row && { avatar_url: row.avatar_url, has_engaged: Boolean(row.has_engaged) };
}

export function getFirstOutboundMessage(conversationId: number):
  | { text: string; created_at: string; template_name: string | null }
  | undefined {
  const row = db
    .prepare<
      [number],
      { text: string; created_at: string; template_id: number | null }
    >(
      `SELECT text, created_at, template_id FROM messages
       WHERE conversation_id = ? AND direction = 'outbound'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(conversationId);
  if (!row) return undefined;
  const template = findMatchingTemplate(row.text, row.template_id);
  return {
    text: row.text,
    created_at: row.created_at,
    template_name: template?.name ?? null,
  };
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

interface TargetProfileDbRow {
  id: number;
  name: string;
  description: string | null;
  platform: Platform;
  criteria_json: string;
  color: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface TargetProfileRow extends Omit<TargetProfileDbRow, "criteria_json"> {
  criteria: Criterion[];
}

export interface TargetProfileInput {
  name: string;
  description: string | null;
  platform: Platform;
  criteria: Criterion[];
  color: string | null;
}

function toTargetProfile(row: TargetProfileDbRow): TargetProfileRow {
  const { criteria_json, ...rest } = row;
  return { ...rest, criteria: JSON.parse(criteria_json) as Criterion[] };
}

export function listTargetProfiles(filters: {
  platform?: string;
  includeArchived?: boolean;
}): TargetProfileRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (!filters.includeArchived) clauses.push("archived_at IS NULL");
  if (filters.platform) {
    clauses.push("platform = ?");
    params.push(filters.platform);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare<
      string[],
      TargetProfileDbRow
    >(`SELECT * FROM target_profiles ${where} ORDER BY updated_at DESC, id DESC`)
    .all(...params)
    .map(toTargetProfile);
}

export function getTargetProfileById(id: number): TargetProfileRow | undefined {
  const row = db
    .prepare<[number], TargetProfileDbRow>("SELECT * FROM target_profiles WHERE id = ?")
    .get(id);
  return row && toTargetProfile(row);
}

export function createTargetProfile(input: TargetProfileInput): TargetProfileRow {
  const result = db
    .prepare(
      `INSERT INTO target_profiles (name, description, platform, criteria_json, color)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.description,
      input.platform,
      JSON.stringify(input.criteria),
      input.color,
    );
  return getTargetProfileById(result.lastInsertRowid as number)!;
}

export function updateTargetProfile(
  id: number,
  input: TargetProfileInput,
): TargetProfileRow | undefined {
  db.prepare(
    `UPDATE target_profiles
     SET name = ?, description = ?, platform = ?, criteria_json = ?, color = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.name,
    input.description,
    input.platform,
    JSON.stringify(input.criteria),
    input.color,
    id,
  );
  return getTargetProfileById(id);
}

export function setTargetProfileArchived(id: number, archived: boolean): void {
  db.prepare(
    `UPDATE target_profiles
     SET archived_at = ${archived ? "datetime('now')" : "NULL"}, updated_at = datetime('now')
     WHERE id = ?`,
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
  avg_response_hours: number | null;
  conversations: TemplateConversation[];
}

export interface TemplateConversation {
  id: number;
  platform: string;
  participant_handle: string;
  participant_name: string | null;
  sent_at: string;
  replied: boolean;
  response_hours: number | null;
}

const TOKEN_RE = /\{\{\s*[\w.]+\s*\}\}/g;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// A template matches a sent message when everything outside its {{tokens}}
// is identical — tokens are the only part that ever varies between sends.
function compileTemplate(body: string): { regex: RegExp; literalLength: number } {
  const normalized = normalizeWhitespace(body);
  const literals = normalized.split(TOKEN_RE);
  const escaped = literals.map((part) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return {
    regex: new RegExp(`^${escaped.join("[\\s\\S]+?")}$`),
    literalLength: literals.join("").length,
  };
}

// Which template (if any) a sent message came from: its recorded
// template_id, otherwise the template whose fixed text it matches best.
export function findMatchingTemplate(
  text: string,
  templateId?: number | null,
): MessageTemplateRow | undefined {
  const templates = db
    .prepare<[], MessageTemplateRow>("SELECT * FROM message_templates")
    .all();
  if (templateId != null) {
    const tagged = templates.find((t) => t.id === templateId);
    if (tagged) return tagged;
  }
  const normalized = normalizeWhitespace(text);
  let best: MessageTemplateRow | undefined;
  let bestLength = -1;
  for (const t of templates) {
    const { regex, literalLength } = compileTemplate(t.body);
    if (literalLength > bestLength && regex.test(normalized)) {
      best = t;
      bestLength = literalLength;
    }
  }
  return best;
}

function parseSqliteUtc(value: string): number {
  return Date.parse(value.replace(" ", "T") + "Z");
}

// Hit rate is measured by scanning every thread in the unified inbox for
// outbound messages that match a template (not just ones sent through the
// app), so DMs sent natively and synced in count too. A template "hit" is a
// thread where the prospect replied after the matching message.
export function getMessageTemplateStats(): MessageTemplateStats[] {
  const templates = db
    .prepare<[], MessageTemplateRow>(
      "SELECT * FROM message_templates ORDER BY created_at DESC",
    )
    .all();
  const compiled = templates.map((t) => ({
    id: t.id,
    ...compileTemplate(t.body),
  }));

  const messages = db
    .prepare<
      [],
      {
        id: number;
        conversation_id: number;
        direction: "inbound" | "outbound";
        text: string;
        created_at: string;
        template_id: number | null;
      }
    >(
      "SELECT id, conversation_id, direction, text, created_at, template_id FROM messages ORDER BY conversation_id, created_at ASC, id ASC",
    )
    .all();

  const byConversation = new Map<number, typeof messages>();
  for (const m of messages) {
    const list = byConversation.get(m.conversation_id);
    if (list) list.push(m);
    else byConversation.set(m.conversation_id, [m]);
  }

  const conversationInfo = new Map(
    db
      .prepare<
        [],
        {
          id: number;
          platform: string;
          participant_handle: string;
          participant_name: string | null;
        }
      >(
        "SELECT id, platform, participant_handle, participant_name FROM conversations",
      )
      .all()
      .map((c) => [c.id, c]),
  );

  const totals = new Map<
    number,
    {
      sent: number;
      replied: number;
      responseHours: number[];
      conversations: TemplateConversation[];
    }
  >(
    templates.map((t) => [
      t.id,
      { sent: 0, replied: 0, responseHours: [], conversations: [] },
    ]),
  );

  for (const thread of byConversation.values()) {
    // One count per template per thread: the first matching outbound message.
    const counted = new Set<number>();
    thread.forEach((m, index) => {
      if (m.direction !== "outbound") return;

      let matchId: number | null = null;
      if (m.template_id != null && totals.has(m.template_id)) {
        matchId = m.template_id;
      } else {
        const text = normalizeWhitespace(m.text);
        let best = -1;
        for (const c of compiled) {
          if (c.literalLength > best && c.regex.test(text)) {
            best = c.literalLength;
            matchId = c.id;
          }
        }
      }
      if (matchId == null || counted.has(matchId)) return;
      counted.add(matchId);

      const total = totals.get(matchId)!;
      total.sent++;
      const reply = thread.slice(index + 1).find((r) => r.direction === "inbound");
      let responseHours: number | null = null;
      if (reply) {
        total.replied++;
        const hours =
          (parseSqliteUtc(reply.created_at) - parseSqliteUtc(m.created_at)) /
          3_600_000;
        if (Number.isFinite(hours)) {
          responseHours = Math.max(0, hours);
          total.responseHours.push(responseHours);
        }
      }
      const info = conversationInfo.get(m.conversation_id);
      if (info) {
        total.conversations.push({
          id: info.id,
          platform: info.platform,
          participant_handle: info.participant_handle,
          participant_name: info.participant_name,
          sent_at: m.created_at,
          replied: reply != null,
          response_hours: responseHours,
        });
      }
    });
  }

  return templates.map((t) => {
    const total = totals.get(t.id)!;
    return {
      id: t.id,
      name: t.name,
      body: t.body,
      archived_at: t.archived_at,
      sent: total.sent,
      replied: total.replied,
      reply_rate: total.sent > 0 ? total.replied / total.sent : 0,
      avg_response_hours: total.responseHours.length
        ? total.responseHours.reduce((a, b) => a + b, 0) /
          total.responseHours.length
        : null,
      conversations: total.conversations.sort((a, b) =>
        b.sent_at.localeCompare(a.sent_at),
      ),
    };
  });
}

// ---- Meta API usage meter (docs/meta-api-usage-meter.md) ----

// Call rows only matter for the last 24h; keep 30 days for debugging.
db.prepare(
  "DELETE FROM meta_api_calls WHERE created_at < datetime('now', '-30 days')",
).run();

export function recordMetaCall(input: {
  accountId: number | null;
  kind: MetaCallKind;
  status: number;
  throttled: boolean;
}): void {
  db.prepare(
    "INSERT INTO meta_api_calls (account_id, kind, status, throttled) VALUES (?, ?, ?, ?)",
  ).run(input.accountId, input.kind, input.status, input.throttled ? 1 : 0);
}

export function saveMetaUsageReading(
  accountId: number,
  reading: MetaUsageReading,
): void {
  db.prepare(
    `INSERT INTO meta_api_usage (account_id, call_count_pct, total_time_pct, total_cputime_pct, regain_access_minutes, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET
       call_count_pct = excluded.call_count_pct,
       total_time_pct = excluded.total_time_pct,
       total_cputime_pct = excluded.total_cputime_pct,
       regain_access_minutes = excluded.regain_access_minutes,
       updated_at = excluded.updated_at`,
  ).run(
    accountId,
    reading.callCountPct,
    reading.totalTimePct,
    reading.totalCputimePct,
    reading.regainAccessMinutes,
  );
}

/** Id of the newest Meta call row: a watermark for "calls made after this". */
export function lastMetaCallId(): number {
  return (
    db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM meta_api_calls").get() as { id: number }
  ).id;
}

/**
 * Counts this account's Meta calls after `afterId` (from lastMetaCallId) and
 * stores it as the last Sync's cost. By id, not time: created_at only has
 * one-second resolution, so a time cutoff also counted calls made just
 * before the sync started.
 */
export function recordSyncCost(accountId: number, afterId: number): number {
  const { calls } = db
    .prepare(
      "SELECT COUNT(*) AS calls FROM meta_api_calls WHERE account_id = ? AND id > ?",
    )
    .get(accountId, afterId) as { calls: number };
  db.prepare(
    `INSERT INTO meta_api_usage (account_id, last_sync_calls, last_sync_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET
       last_sync_calls = excluded.last_sync_calls,
       last_sync_at = excluded.last_sync_at`,
  ).run(accountId, calls);
  return calls;
}

export interface MetaUsageSummaryRow {
  lastHour: number;
  last24h: number;
  sendsLastHour: number;
  throttledLastHour: number;
  throttledLast24h: number;
  lastThrottledAt: string | null;
  byKind: Record<string, number>;
  // Meta's own reading; null when it's more than a day old, since it only
  // updates when we make a call.
  reading: (MetaUsageReading & { updatedAt: string }) | null;
  lastSyncCalls: number | null;
  lastSyncAt: string | null;
}

export function getMetaUsageSummary(accountId: number): MetaUsageSummaryRow {
  const counts = db
    .prepare(
      `SELECT
         COALESCE(SUM(created_at >= datetime('now', '-1 hour')), 0) AS lastHour,
         COUNT(*) AS last24h,
         COALESCE(SUM(kind = 'send' AND created_at >= datetime('now', '-1 hour')), 0) AS sendsLastHour,
         COALESCE(SUM(throttled AND created_at >= datetime('now', '-1 hour')), 0) AS throttledLastHour,
         COALESCE(SUM(throttled), 0) AS throttledLast24h,
         MAX(CASE WHEN throttled THEN created_at END) AS lastThrottledAt
       FROM meta_api_calls
       WHERE account_id = ? AND created_at >= datetime('now', '-1 day')`,
    )
    .get(accountId) as Omit<MetaUsageSummaryRow, "byKind" | "reading" | "lastSyncCalls" | "lastSyncAt">;

  const kinds = db
    .prepare(
      `SELECT kind, COUNT(*) AS calls FROM meta_api_calls
       WHERE account_id = ? AND created_at >= datetime('now', '-1 day')
       GROUP BY kind`,
    )
    .all(accountId) as { kind: string; calls: number }[];

  const usage = db
    .prepare(
      `SELECT *, updated_at >= datetime('now', '-1 day') AS fresh
       FROM meta_api_usage WHERE account_id = ?`,
    )
    .get(accountId) as
    | {
        call_count_pct: number | null;
        total_time_pct: number | null;
        total_cputime_pct: number | null;
        regain_access_minutes: number | null;
        updated_at: string | null;
        last_sync_calls: number | null;
        last_sync_at: string | null;
        fresh: number | null;
      }
    | undefined;

  return {
    ...counts,
    byKind: Object.fromEntries(kinds.map((k) => [k.kind, k.calls])),
    reading:
      usage?.updated_at && usage.fresh
        ? {
            callCountPct: usage.call_count_pct,
            totalTimePct: usage.total_time_pct,
            totalCputimePct: usage.total_cputime_pct,
            regainAccessMinutes: usage.regain_access_minutes,
            updatedAt: usage.updated_at,
          }
        : null,
    lastSyncCalls: usage?.last_sync_calls ?? null,
    lastSyncAt: usage?.last_sync_at ?? null,
  };
}

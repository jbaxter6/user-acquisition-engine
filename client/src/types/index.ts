export type Platform = "instagram" | "tiktok" | "twitch" | "youtube";

export interface Conversation {
  id: number;
  platform: Platform;
  account_id: number | null;
  external_id: string;
  participant_handle: string;
  participant_name: string | null;
  participant_avatar_url: string | null;
  status: string;
  last_message_at: string;
  created_at: string;
  last_message_text?: string;
  last_message_direction?: "inbound" | "outbound";
  // 0/1 from SQLite — whether the other party has ever actually messaged
  // us (vs. outbound-only, us reaching out with no reply yet). Meta won't
  // reveal their profile/avatar until they have — see Avatar's `engaged` prop.
  has_engaged?: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  direction: "inbound" | "outbound";
  text: string;
  source: "api" | "manual" | "webhook";
  external_message_id: string | null;
  created_at: string;
}

export interface HealthResponse {
  ok: boolean;
  adapters: Record<Platform, { canSend: boolean; connectedAccounts?: number }>;
}

export interface InstagramAccount {
  id: number;
  username: string | null;
  igUserId: string;
  profilePictureUrl: string | null;
  connectedAt: string;
}

// GET /api/meta/usage — see docs/meta-api-usage-meter.md.
export type MetaUsageLevel = "ok" | "warn" | "over";

export interface MetaAccountUsage {
  accountId: number;
  username: string | null;
  calls: { lastHour: number; last24h: number; byKind: Record<string, number> };
  sendsLastHour: number;
  meta: {
    callCountPct: number | null;
    totalTimePct: number | null;
    totalCputimePct: number | null;
    regainAccessMinutes: number | null;
    highestPct: number | null;
    updatedAt: string;
  } | null;
  lastThrottledAt: string | null;
  lastSyncCalls: number | null;
  lastSyncAt: string | null;
  level: MetaUsageLevel;
}

export interface MetaUsageResponse {
  thresholds: { metaPctWarn: number; metaPctOver: number; sendsWarn: number; sendsOver: number };
  accounts: MetaAccountUsage[];
}

export interface MessageTemplate {
  id: number;
  name: string;
  body: string;
  created_at: string;
  archived_at: string | null;
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
  platform: Platform;
  participant_handle: string;
  participant_name: string | null;
  sent_at: string;
  replied: boolean;
  response_hours: number | null;
}

export interface ProspectContact {
  id: number;
  prospect_id: number;
  platform: Platform;
  handle: string;
  name: string | null;
  role: string;
  is_primary: number;
  source: string;
  last_seen_at: string;
}

export interface ProspectChannel {
  id: number;
  prospect_id: number;
  platform: Platform;
  username: string;
  conversation_id: number | null;
  source: string;
  last_seen_at: string;
}

export interface ProspectLink {
  id: number;
  platform: Platform;
  username: string;
  display_name: string | null;
  status: "new" | "contacted" | "replied" | "closed";
  followers: number | null;
  relationship: string;
}

export interface ProspectThread {
  conversation_id: number;
  account: {
    id: number;
    username: string | null;
    profile_picture_url: string | null;
  } | null;
  first_outbound: {
    text: string;
    created_at: string;
    template_name: string | null;
  } | null;
  avatar_url: string | null;
  has_engaged: boolean;
}

export interface Prospect {
  id: number;
  platform: Platform;
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
  // Set once this prospect has an inbox thread — either from having been
  // "contacted" through this pipeline (conversation_id) or from an
  // already-existing conversation matched by handle (e.g. synced from a
  // webhook). Prefer this over conversation_id for "does a thread exist."
  existing_conversation_id?: number | null;
  avatar_url?: string | null;
  has_engaged?: boolean;
  // One entry per conversation with this person (one per connected account
  // that has messaged them), oldest first.
  threads?: ProspectThread[];
  first_outbound_message?: {
    text: string;
    created_at: string;
    template_name: string | null;
  } | null;
  created_at: string;
  contacted_at: string | null;
  contacts?: ProspectContact[];
  channels?: ProspectChannel[];
  links?: ProspectLink[];
  // Observed profile data (scraper/import), keyed by attribute registry key.
  attributes?: Record<string, ProspectAttributeValue>;
}

export interface ProspectAttributeValue {
  value: unknown;
  source: string;
  observed_at: string;
}

// ---- Target profiles ("Profiles" page) ----
// Mirrors server/src/profiles/attributes.ts — the server's registry is the
// source of truth and is fetched at runtime; these are just the shapes.

export type AttributeType =
  | "count"
  | "percent"
  | "number"
  | "enum"
  | "keywords"
  | "boolean"
  // Display-only (shown on prospect cards, not usable as criteria).
  | "text"
  | "list";

export type CriterionOperator =
  | "between"
  | "gte"
  | "lte"
  | "in"
  | "not_in"
  | "contains_any"
  | "contains_none"
  | "is";

export type AttributeGroup = "audience" | "content" | "identity";

export interface AttributeDef {
  key: string;
  label: string;
  group: AttributeGroup;
  platforms: Platform[];
  type: AttributeType;
  unit?: string;
  options?: { value: string; label: string }[];
  description: string;
  filterable: boolean;
  // Platforms where a data source fills this today.
  hasData: Platform[];
}

export interface AttributeRegistry {
  attributes: AttributeDef[];
  operators: Record<AttributeType, CriterionOperator[]>;
}

export type CriterionValue = number | boolean | [number, number] | string[];

export interface Criterion {
  id: string;
  attribute: string;
  operator: CriterionOperator;
  value: CriterionValue;
  mode: "required" | "preferred";
  weight?: 1 | 2 | 3;
}

export interface TargetProfile {
  id: number;
  name: string;
  description: string | null;
  platform: Platform;
  criteria: Criterion[];
  color: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface TargetProfileInput {
  name: string;
  description: string | null;
  platform: Platform;
  criteria: Criterion[];
  color: string | null;
}

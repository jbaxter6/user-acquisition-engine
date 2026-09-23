export type Platform = "instagram" | "tiktok" | "twitch";

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
  first_outbound_message?: { text: string; created_at: string } | null;
  created_at: string;
  contacted_at: string | null;
  contacts?: ProspectContact[];
  channels?: ProspectChannel[];
  links?: ProspectLink[];
}

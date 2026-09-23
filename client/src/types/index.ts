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
  created_at: string;
  contacted_at: string | null;
}

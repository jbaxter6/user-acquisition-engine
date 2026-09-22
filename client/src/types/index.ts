export type Platform = "instagram" | "tiktok" | "twitch";

export interface Conversation {
  id: number;
  platform: Platform;
  account_id: number | null;
  external_id: string;
  participant_handle: string;
  participant_name: string | null;
  status: string;
  last_message_at: string;
  created_at: string;
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
  connectedAt: string;
}

import type { Conversation, HealthResponse, InstagramAccount, Message, Platform } from "../types";

// In dev, client/.env.local points this at the separate server on :4000.
// In production the built app is served from the same origin as the API
// (see server/src/index.ts), so an empty base URL — same-origin relative
// requests — is the correct default when VITE_API_URL isn't set.
const BASE_URL = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  baseUrl: BASE_URL,

  health: () => request<HealthResponse>("/api/health"),

  listInstagramAccounts: () => request<InstagramAccount[]>("/auth/instagram/accounts"),

  disconnectInstagramAccount: (id: number) =>
    request<{ ok: true }>(`/auth/instagram/accounts/${id}`, { method: "DELETE" }),

  listConversations: (platform?: Platform) =>
    request<Conversation[]>(`/api/conversations${platform ? `?platform=${platform}` : ""}`),

  listMessages: (conversationId: number) =>
    request<Message[]>(`/api/conversations/${conversationId}/messages`),

  sendMessage: (conversationId: number, text: string) =>
    request<Message>(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  addManualMessage: (input: {
    platform: Platform;
    participantHandle: string;
    participantName?: string;
    text: string;
  }) =>
    request<{ conversation: Conversation; message: Message }>("/api/conversations/manual", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

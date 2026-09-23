import type {
  Conversation,
  HealthResponse,
  InstagramAccount,
  Message,
  MessageTemplate,
  MessageTemplateStats,
  Platform,
  Prospect,
} from "../types";
import type { MappedProspect } from "../lib/prospectImport";

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

  syncInstagramAccount: (id: number) =>
    request<{ conversations: number; newMessages: number }>(`/auth/instagram/accounts/${id}/sync`, {
      method: "POST",
    }),

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

  listProspects: (filters?: { status?: string; platform?: Platform }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.platform) params.set("platform", filters.platform);
    const qs = params.toString();
    return request<Prospect[]>(`/api/prospects${qs ? `?${qs}` : ""}`);
  },

  bulkImportProspects: (prospects: MappedProspect[]) =>
    request<{ received: number; inserted: number; skipped: number }>("/api/prospects/bulk", {
      method: "POST",
      body: JSON.stringify({ prospects }),
    }),

  deleteProspect: (id: number) => request<{ ok: true }>(`/api/prospects/${id}`, { method: "DELETE" }),

  messageProspect: (id: number, accountId: number, text: string, templateId?: number) =>
    request<{ conversationId: number }>(`/api/prospects/${id}/message`, {
      method: "POST",
      body: JSON.stringify({ accountId, text, templateId }),
    }),

  markProspectContactedManually: (id: number, accountId: number | null, text: string, templateId?: number) =>
    request<{ conversationId: number }>(`/api/prospects/${id}/mark-contacted`, {
      method: "POST",
      body: JSON.stringify({ accountId, text, templateId }),
    }),

  addProspectContact: (id: number, input: { handle: string; name?: string; role?: string; isPrimary?: boolean }) =>
    request<{ id: number; prospect_id: number; handle: string; name: string | null; role: string }>(`/api/prospects/${id}/contacts`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  mergeProspects: (sourceId: number, targetId: number) =>
    request<Prospect>(`/api/prospects/${sourceId}/merge`, {
      method: "POST",
      body: JSON.stringify({ targetId }),
    }),

  listTemplates: () => request<MessageTemplate[]>("/api/templates"),

  templateStats: () => request<MessageTemplateStats[]>("/api/templates/stats"),

  createTemplate: (name: string, body: string) =>
    request<MessageTemplate>("/api/templates", {
      method: "POST",
      body: JSON.stringify({ name, body }),
    }),

  updateTemplate: (id: number, name: string, body: string) =>
    request<MessageTemplate>(`/api/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, body }),
    }),

  archiveTemplate: (id: number) => request<{ ok: true }>(`/api/templates/${id}`, { method: "DELETE" }),
};

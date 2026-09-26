import type {
  AttributeRegistry,
  Conversation,
  HealthResponse,
  InstagramAccount,
  Message,
  MessageTemplate,
  MessageTemplateStats,
  MetaUsageResponse,
  Platform,
  Prospect,
  TargetProfile,
  TargetProfileInput,
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
    credentials: "include",
    ...init,
  });
  if (res.status === 401 && !path.startsWith("/api/session")) {
    // Session expired or missing — send the user back to the login page.
    window.dispatchEvent(new Event("auth-required"));
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  baseUrl: BASE_URL,

  health: () => request<HealthResponse>("/api/health"),

  session: () =>
    request<{ required: boolean; authenticated: boolean }>("/api/session"),

  login: async (password: string) => {
    const res = await fetch(`${BASE_URL}/api/session/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? "Couldn't sign in. Try again.");
    }
  },

  logout: () =>
    request<{ ok: true }>("/api/session/logout", { method: "POST" }),

  listInstagramAccounts: () =>
    request<InstagramAccount[]>("/auth/instagram/accounts"),

  disconnectInstagramAccount: (id: number) =>
    request<{ ok: true }>(`/auth/instagram/accounts/${id}`, {
      method: "DELETE",
    }),

  syncInstagramAccount: (id: number) =>
    request<{ conversations: number; newMessages: number; apiCalls: number }>(
      `/auth/instagram/accounts/${id}/sync`,
      {
        method: "POST",
      },
    ),

  listConversations: (platform?: Platform) =>
    request<Conversation[]>(
      `/api/conversations${platform ? `?platform=${platform}` : ""}`,
    ),

  listMessages: (conversationId: number) =>
    request<Message[]>(`/api/conversations/${conversationId}/messages`),

  // Sends go through Meta, so nudge the usage meter to refresh.
  sendMessage: (conversationId: number, text: string) =>
    request<Message>(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }).finally(() => window.dispatchEvent(new Event("meta-usage-changed"))),

  metaUsage: () => request<MetaUsageResponse>("/api/meta/usage"),

  addManualMessage: (input: {
    platform: Platform;
    participantHandle: string;
    participantName?: string;
    text: string;
  }) =>
    request<{ conversation: Conversation; message: Message }>(
      "/api/conversations/manual",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),

  listProspects: (params: {
    status?: string;
    platform?: Platform;
    q?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") qs.set(key, String(value));
    }
    const query = qs.toString();
    return request<{ items: Prospect[]; total: number }>(
      `/api/prospects${query ? `?${query}` : ""}`,
    );
  },

  prospectCounts: (params: { platform?: Platform; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.platform) qs.set("platform", params.platform);
    if (params.q) qs.set("q", params.q);
    const query = qs.toString();
    return request<Record<"all" | "new" | "contacted" | "replied" | "closed", number>>(
      `/api/prospects/counts${query ? `?${query}` : ""}`,
    );
  },

  bulkImportProspects: (prospects: MappedProspect[]) =>
    request<{
      received: number;
      inserted: number;
      skipped: number;
      enriched: number;
      attributesDropped: number;
    }>(
      "/api/prospects/bulk",
      {
        method: "POST",
        body: JSON.stringify({ prospects }),
      },
    ),

  deleteProspect: (id: number) =>
    request<{ ok: true }>(`/api/prospects/${id}`, { method: "DELETE" }),

  markProspectContactedManually: (
    id: number,
    accountId: number | null,
    text: string,
    templateId?: number,
  ) =>
    request<{ conversationId: number }>(`/api/prospects/${id}/mark-contacted`, {
      method: "POST",
      body: JSON.stringify({ accountId, text, templateId }),
    }),

  addProspectContact: (
    id: number,
    input: {
      handle: string;
      name?: string;
      role?: string;
      isPrimary?: boolean;
    },
  ) =>
    request<{
      id: number;
      prospect_id: number;
      handle: string;
      name: string | null;
      role: string;
    }>(`/api/prospects/${id}/contacts`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  mergeProspects: (sourceId: number, targetId: number) =>
    request<Prospect>(`/api/prospects/${sourceId}/merge`, {
      method: "POST",
      body: JSON.stringify({ targetId }),
    }),

  linkProspectChannel: (id: number, platform: string, username: string) =>
    request<Prospect>(`/api/prospects/${id}/channels`, {
      method: "POST",
      body: JSON.stringify({ platform, username }),
    }),

  linkProspectManager: (id: number, platform: string, username: string, role: string) =>
    request<Prospect>(`/api/prospects/${id}/managers`, {
      method: "POST",
      body: JSON.stringify({ platform, username, role }),
    }),

  unlinkProspect: (id: number, linkedId: number) =>
    request<{ ok: true }>(`/api/prospects/${id}/links/${linkedId}`, {
      method: "DELETE",
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

  archiveTemplate: (id: number) =>
    request<{ ok: true }>(`/api/templates/${id}`, { method: "DELETE" }),

  profileAttributes: () =>
    request<AttributeRegistry>("/api/profiles/attributes"),

  listProfiles: (includeArchived = false) =>
    request<TargetProfile[]>(
      `/api/profiles${includeArchived ? "?includeArchived=true" : ""}`,
    ),

  createProfile: (input: TargetProfileInput) =>
    request<TargetProfile>("/api/profiles", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateProfile: (id: number, input: TargetProfileInput) =>
    request<TargetProfile>(`/api/profiles/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  duplicateProfile: (id: number) =>
    request<TargetProfile>(`/api/profiles/${id}/duplicate`, { method: "POST" }),

  archiveProfile: (id: number) =>
    request<{ ok: true }>(`/api/profiles/${id}`, { method: "DELETE" }),

  restoreProfile: (id: number) =>
    request<TargetProfile>(`/api/profiles/${id}/restore`, { method: "POST" }),
};

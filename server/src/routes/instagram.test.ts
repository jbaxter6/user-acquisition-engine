// Connecting Instagram accounts (OAuth), Sync, and what happens when Meta
// revokes a token. Meta's API is faked; nothing leaves the machine.
import { describe, expect, it } from "vitest";
import { jsonResponse, useFakeMeta, useTestServer, type MetaCall } from "../test/harness.js";

const { api } = useTestServer();

const OUR_IG_ID = "17840000000000001";
let tokenRevoked = false;
let longLivedToken = "long-token-1";

const revoked = () =>
  jsonResponse(
    {
      error: {
        message: "Error validating access token: The session has been invalidated because the user changed their password",
        type: "OAuthException",
        code: 190,
      },
    },
    400,
  );

function fakeMeta({ method, url }: MetaCall): Response {
  const p = url.pathname;
  if (url.hostname === "api.instagram.com" && p === "/oauth/access_token") {
    return jsonResponse({ access_token: "short-token", user_id: OUR_IG_ID });
  }
  if (p === "/access_token") return jsonResponse({ access_token: longLivedToken, expires_in: 5183944 });
  if (tokenRevoked) return revoked();
  if (p.endsWith("/subscribed_apps") && method === "POST") return jsonResponse({ success: true });
  if (p === "/v21.0/me") {
    return jsonResponse({ user_id: OUR_IG_ID, username: "smoothmediatechnologies", profile_picture_url: "https://cdn.example/me.jpg" });
  }
  if (p === "/v21.0/me/conversations") return jsonResponse({ data: [{ id: "conv-1", updated_time: "2026-09-20T10:00:00+0000" }] });
  if (p === "/v21.0/conv-1") return jsonResponse({ messages: { data: [{ id: "m1" }, { id: "m2" }] } });
  if (p === "/v21.0/m1") {
    return jsonResponse({
      id: "m1",
      created_time: "2026-09-20T09:00:00+0000",
      message: "hey are you taking submissions?",
      from: { id: "creator-9", username: "beatmaker9" },
      to: { data: [{ id: OUR_IG_ID, username: "smoothmediatechnologies" }] },
    });
  }
  if (p === "/v21.0/m2") {
    return jsonResponse({
      id: "m2",
      created_time: "2026-09-20T09:30:00+0000",
      message: "yes! send it over",
      from: { id: OUR_IG_ID, username: "smoothmediatechnologies" },
      to: { data: [{ id: "creator-9", username: "beatmaker9" }] },
    });
  }
  if (p === "/v21.0/creator-9") return jsonResponse({ username: "beatmaker9", profile_pic: "https://cdn.example/9.jpg" });
  return jsonResponse({ error: { message: `unexpected fake Meta call ${method} ${p}` } }, 500);
}

const metaCalls = useFakeMeta(fakeMeta);
const accounts = async () => (await (await api("/auth/instagram/accounts")).json()) as Array<Record<string, any>>;

// Walks the real OAuth round trip: /login issues a state, Instagram
// redirects back to /callback with a code.
async function connect(): Promise<Response> {
  const login = await api("/auth/instagram/login");
  const authorize = new URL(login.headers.get("location")!);
  expect(authorize.hostname).toBe("www.instagram.com");
  const state = authorize.searchParams.get("state");
  return api(`/auth/instagram/callback?code=abc123%23_&state=${state}`);
}

describe("connecting an account", () => {
  it("rejects a callback without a state we issued", async () => {
    const res = await api("/auth/instagram/callback?code=abc&state=forged");
    expect(res.headers.get("location")).toContain("instagram=error&reason=invalid_state");
  });

  it("exchanges the code, stores the account, and subscribes it to webhooks", async () => {
    const res = await connect();
    expect(res.headers.get("location")).toBe("http://localhost:5173/?instagram=connected&username=smoothmediatechnologies");

    // Instagram's trailing "#_" is stripped from the code before exchanging it.
    const exchange = metaCalls.find((c) => c.url.hostname === "api.instagram.com");
    expect(new URLSearchParams(exchange!.body).get("code")).toBe("abc123");
    expect(metaCalls.some((c) => c.url.pathname.endsWith("/subscribed_apps"))).toBe(true);

    expect(await accounts()).toMatchObject([
      { username: "smoothmediatechnologies", igUserId: OUR_IG_ID, needsReconnect: false },
    ]);
  });
});

describe("Sync", () => {
  it("pulls conversations and messages, and reports what it cost", async () => {
    const [account] = await accounts();
    const res = await api(`/auth/instagram/accounts/${account.id}/sync`, { method: "POST" });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result).toMatchObject({ conversations: 1, newMessages: 2 });
    expect(result.apiCalls).toBe(metaCalls.length);

    const [conversation] = await (await api("/api/conversations")).json();
    expect(conversation).toMatchObject({ participant_handle: "beatmaker9", participant_avatar_url: "https://cdn.example/9.jpg" });
    const messages = await (await api(`/api/conversations/${conversation.id}/messages`)).json();
    expect(messages.map((m: { direction: string; text: string }) => [m.direction, m.text])).toEqual([
      ["inbound", "hey are you taking submissions?"],
      ["outbound", "yes! send it over"],
    ]);
    // Sent times come from Meta, not from when we synced.
    expect(messages[0].created_at).toBe("2026-09-20 09:00:00");

    // A synced creator becomes a prospect.
    const prospects = await (await api("/api/prospects")).json();
    expect(prospects.items.map((p: { username: string }) => p.username)).toContain("beatmaker9");
  });

  it("doesn't duplicate messages on a second sync", async () => {
    const [account] = await accounts();
    const result = await (await api(`/auth/instagram/accounts/${account.id}/sync`, { method: "POST" })).json();
    expect(result.newMessages).toBe(0);
  });

  it("shows sync calls in the usage meter", async () => {
    const usage = await (await api("/api/meta/usage")).json();
    expect(usage.accounts[0].calls.byKind["sync.message"]).toBeGreaterThanOrEqual(4);
    expect(usage.accounts[0].lastSyncCalls).toBeGreaterThan(0);
    expect(usage.accounts[0].level).toBe("ok");
  });

  it("404s for an unknown account", async () => {
    expect((await api("/auth/instagram/accounts/9999/sync", { method: "POST" })).status).toBe(404);
  });
});

describe("when Instagram revokes the token", () => {
  it("fails the sync with needsReconnect and flags the account", async () => {
    tokenRevoked = true;
    const [account] = await accounts();
    const res = await api(`/auth/instagram/accounts/${account.id}/sync`, { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ needsReconnect: true });
    expect((await accounts())[0].needsReconnect).toBe(true);
  });

  it("stays flagged when a later call re-saves the same dead token", async () => {
    // Nothing but a reconnect with a new token clears the flag.
    const [account] = await accounts();
    await api(`/auth/instagram/accounts/${account.id}/sync`, { method: "POST" });
    expect((await accounts())[0].needsReconnect).toBe(true);
  });

  it("clears the flag once the account is reconnected with a new token", async () => {
    tokenRevoked = false;
    longLivedToken = "long-token-2";
    await connect();
    expect(await accounts()).toMatchObject([{ igUserId: OUR_IG_ID, needsReconnect: false }]);
  });
});

describe("disconnecting", () => {
  // Regression: this used to 500 (foreign key) for any account with threads.
  it("hides the account but keeps its conversations", async () => {
    const [account] = await accounts();
    const res = await api(`/auth/instagram/accounts/${account.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await accounts()).toEqual([]);

    const [conversation] = await (await api("/api/conversations")).json();
    expect(conversation).toMatchObject({ participant_handle: "beatmaker9", account_id: account.id });
    expect((await api(`/auth/instagram/accounts/${account.id}/sync`, { method: "POST" })).status).toBe(404);
  });

  it("brings the same account and its threads back on reconnect", async () => {
    const [conversation] = await (await api("/api/conversations")).json();
    await connect();
    const [account] = await accounts();
    expect(account.id).toBe(conversation.account_id);
  });
});

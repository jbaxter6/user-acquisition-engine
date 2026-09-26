// Inbox: Meta's webhook delivering messages, manual entries, and replies
// sent through the Instagram API (faked).
import { beforeAll, describe, expect, it } from "vitest";
import { upsertAccount } from "../db.js";
import { jsonResponse, useFakeMeta, useTestServer } from "../test/harness.js";

const { api } = useTestServer();

let sendFails = false;
const metaCalls = useFakeMeta((call) => {
  if (call.method === "POST" && call.url.pathname.endsWith("/messages")) {
    return sendFails
      ? jsonResponse({ error: { message: "Outside of allowed window", code: 10 } }, 400)
      : jsonResponse({ recipient_id: "creator-1", message_id: "mid.sent.1" });
  }
  // Avatar backfill after an inbound message.
  return jsonResponse({ username: "creator_one", profile_pic: "https://cdn.example/pic.jpg" });
});

const OUR_IG_ID = "ig-ours";
let accountId: number;
beforeAll(() => {
  accountId = upsertAccount({ igUserId: OUR_IG_ID, username: "smooth_test", accessToken: "token-1" }).id;
});

const webhook = (text: string, extra: Record<string, unknown> = {}) =>
  api("/webhooks/instagram", {
    method: "POST",
    json: {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: { sender: { id: "creator-1" }, recipient: { id: OUR_IG_ID }, message: { mid: `mid.${text}`, text, ...extra } },
            },
          ],
        },
      ],
    },
  });

const conversations = async () => (await (await api("/api/conversations")).json()) as Array<Record<string, any>>;

describe("Meta webhook", () => {
  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = await api("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=abc123");
    expect(await ok.text()).toBe("abc123");
    const bad = await api("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123");
    expect(bad.status).toBe(403);
  });

  it("files an inbound DM under the account it arrived on", async () => {
    expect((await webhook("hey, saw your post")).status).toBe(200);
    const [conversation] = await conversations();
    expect(conversation).toMatchObject({
      platform: "instagram",
      external_id: "creator-1",
      account_id: accountId,
      last_message_text: "hey, saw your post",
      last_message_direction: "inbound",
      has_engaged: 1,
    });
  });

  it("ignores echoes of messages we sent ourselves", async () => {
    await webhook("our own reply", { is_echo: true });
    const messages = await (await api(`/api/conversations/${(await conversations())[0].id}/messages`)).json();
    expect(messages.map((m: { text: string }) => m.text)).toEqual(["hey, saw your post"]);
  });
});

describe("sending a reply", () => {
  it("sends through Instagram and records it", async () => {
    const conversation = (await conversations())[0];
    const res = await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", json: { text: "thanks!" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ direction: "outbound", text: "thanks!", source: "api", external_message_id: "mid.sent.1" });

    const send = metaCalls.find((c) => c.method === "POST");
    expect(send?.url.pathname).toBe(`/v21.0/${OUR_IG_ID}/messages`);
    expect(JSON.parse(send!.body!)).toEqual({ recipient: { id: "creator-1" }, message: { text: "thanks!" } });
  });

  it("counts the send in the usage meter", async () => {
    const usage = await (await api("/api/meta/usage")).json();
    expect(usage.accounts[0]).toMatchObject({ accountId, sendsLastHour: 1 });
    expect(usage.accounts[0].calls.byKind.send).toBe(1);
  });

  it("returns 502 with Meta's reason when the send fails", async () => {
    sendFails = true;
    const conversation = (await conversations())[0];
    const res = await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", json: { text: "again" } });
    sendFails = false;
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Outside of allowed window/);
  });

  it("refuses to cold-message someone who hasn't written first", async () => {
    const { id } = (await import("../db.js")).upsertConversation("instagram", "stranger", "stranger", undefined, accountId);
    const res = await api(`/api/conversations/${id}/messages`, { method: "POST", json: { text: "hi" } });
    expect(res.status).toBe(403);
    expect(metaCalls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("requires text", async () => {
    expect((await api("/api/conversations/1/messages", { method: "POST", json: { text: "  " } })).status).toBe(400);
  });
});

describe("platforms without an API (TikTok, Twitch)", () => {
  it("logs an inbound message by hand", async () => {
    const res = await api("/api/conversations/manual", {
      method: "POST",
      json: { platform: "tiktok", participantHandle: "tt_creator", text: "replied on TikTok" },
    });
    expect(res.status).toBe(201);
    const tiktok = await (await api("/api/conversations?platform=tiktok")).json();
    expect(tiktok).toMatchObject([{ participant_handle: "tt_creator", last_message_text: "replied on TikTok" }]);
  });

  it("records a reply as sent manually, without calling any API", async () => {
    const [conversation] = await (await api("/api/conversations?platform=tiktok")).json();
    const res = await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", json: { text: "sent it in the app" } });
    expect(res.status).toBe(201);
    expect((await res.json()).source).toBe("manual");
    expect(metaCalls).toHaveLength(0);
  });

  it("validates manual entries", async () => {
    expect((await api("/api/conversations/manual", { method: "POST", json: { platform: "myspace", participantHandle: "a", text: "b" } })).status).toBe(400);
    expect((await api("/api/conversations/manual", { method: "POST", json: { platform: "tiktok", text: "b" } })).status).toBe(400);
  });
});

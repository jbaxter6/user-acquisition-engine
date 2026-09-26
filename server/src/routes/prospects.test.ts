import { describe, expect, it } from "vitest";
import { useTestServer } from "../test/harness.js";

const { api } = useTestServer();

const importRows = (prospects: unknown) => api("/api/prospects/bulk", { method: "POST", json: { prospects } });
const list = async (query = "") =>
  (await (await api(`/api/prospects${query}`)).json()) as { total: number; items: Array<Record<string, any>> };

describe("POST /api/prospects/bulk", () => {
  it("rejects an empty or missing list", async () => {
    expect((await importRows([])).status).toBe(400);
    expect((await importRows(undefined)).status).toBe(400);
  });

  it("rejects a list where no row has a usable username", async () => {
    expect((await importRows([{ username: "  " }, { followers: 5 }, "junk"])).status).toBe(400);
  });

  it("normalizes handles and platforms, and drops attributes it can't use", async () => {
    const res = await importRows([
      { username: "@alpha", platform: "Instagram", followers: 1200, attributes: { followers: 1200, not_a_real_attribute: 1 } },
      { username: "https://www.tiktok.com/@beta?lang=en", platform: "tiktok" },
      { username: "gamma", platform: "myspace" },
    ]);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ received: 3, inserted: 3, skipped: 0, attributesDropped: 1 });

    const { items } = await list();
    const byName = Object.fromEntries(items.map((p) => [p.username, p]));
    expect(byName.alpha.platform).toBe("instagram");
    expect(byName.beta.platform).toBe("tiktok");
    // Unknown platforms fall back to Instagram rather than being dropped.
    expect(byName.gamma.platform).toBe("instagram");
    expect(byName.alpha.status).toBe("new");
  });

  it("skips people already imported, but refreshes their attributes", async () => {
    const res = await importRows([{ username: "alpha", platform: "instagram", attributes: { followers: 5000 } }]);
    expect(await res.json()).toMatchObject({ inserted: 0, skipped: 1, enriched: 1 });
  });
});

describe("GET /api/prospects", () => {
  it("searches and counts", async () => {
    expect((await list("?q=bet")).items.map((p) => p.username)).toEqual(["beta"]);
    expect((await list("?platform=tiktok")).total).toBe(1);
    const counts = await (await api("/api/prospects/counts")).json();
    expect(counts).toMatchObject({ all: 3, new: 3, contacted: 0 });
  });

  it("lists known handles for the scraper's dedupe", async () => {
    const handles = (await (await api("/api/prospects/handles")).json()) as Array<{ platform: string; username: string }>;
    expect(handles).toEqual(expect.arrayContaining([{ platform: "tiktok", username: "beta" }]));
  });
});

describe("POST /api/prospects/:id/mark-contacted", () => {
  const idOf = async (username: string) => (await list()).items.find((p) => p.username === username)!.id as number;

  it("needs a connected account for Instagram prospects", async () => {
    const res = await api(`/api/prospects/${await idOf("alpha")}/mark-contacted`, { method: "POST", json: { text: "hi" } });
    expect(res.status).toBe(400);
  });

  it("needs message text", async () => {
    const res = await api(`/api/prospects/${await idOf("beta")}/mark-contacted`, { method: "POST", json: { text: " " } });
    expect(res.status).toBe(400);
  });

  it("logs a manual TikTok send as a conversation and marks them contacted", async () => {
    const id = await idOf("beta");
    const res = await api(`/api/prospects/${id}/mark-contacted`, { method: "POST", json: { text: "yo, loved the set" } });
    expect(res.status).toBe(200);
    const { conversationId } = await res.json();

    const messages = await (await api(`/api/conversations/${conversationId}/messages`)).json();
    expect(messages).toMatchObject([{ direction: "outbound", text: "yo, loved the set", source: "manual" }]);
    const beta = (await list()).items.find((p) => p.username === "beta")!;
    expect(beta.status).toBe("contacted");
    expect(beta.existing_conversation_id).toBe(conversationId);
  });

  it("404s for an unknown prospect", async () => {
    expect((await api("/api/prospects/99999/mark-contacted", { method: "POST", json: { text: "x" } })).status).toBe(404);
  });
});

describe("DELETE /api/prospects/:id", () => {
  it("removes the prospect", async () => {
    const gamma = (await list()).items.find((p) => p.username === "gamma")!;
    expect((await api(`/api/prospects/${gamma.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await list()).items.map((p) => p.username)).not.toContain("gamma");
  });
});

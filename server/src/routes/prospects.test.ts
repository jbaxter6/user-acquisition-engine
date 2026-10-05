import { describe, expect, it } from "vitest";
import { SHUFFLE_MASK, SHUFFLE_MULTIPLIER } from "../db.js";
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

describe("GET /api/prospects follower filter", () => {
  const names = async (query: string) =>
    (await list(`${query}${query.includes("?") ? "&" : "?"}sort=name&limit=50`)).items.map((p) => p.username);

  it("keeps prospects inside the range and prefers the attribute over the column", async () => {
    // alpha already has column followers 1200 and an attribute of 5000.
    await importRows([
      { username: "column_only", platform: "instagram", followers: 500 },
      { username: "attr_wins", platform: "instagram", followers: 100, attributes: { followers: 80_000 } },
      { username: "attr_only", platform: "instagram", attributes: { followers: 42_000 } },
      { username: "big", platform: "instagram", followers: 2_000_000 },
      { username: "mystery", platform: "instagram" },
    ]);

    expect(await names("?minFollowers=10000&maxFollowers=100000")).toEqual(["attr_only", "attr_wins"]);
    const atLeast1k = await names("?minFollowers=1000");
    expect(atLeast1k).toEqual(expect.arrayContaining(["alpha", "attr_only", "attr_wins", "big"]));
    expect(atLeast1k).not.toContain("column_only");
    expect(atLeast1k).not.toContain("mystery");
    expect(atLeast1k).not.toContain("beta");
    expect(await names("?maxFollowers=1000")).toEqual(["column_only"]);

    const counts = await (await api("/api/prospects/counts?minFollowers=10000&maxFollowers=100000")).json();
    expect(counts).toMatchObject({ all: 2, new: 2, contacted: 0 });
  });

  it("ignores a bound that isn't a non-negative number", async () => {
    const open = (await list("?limit=50")).total;
    expect((await list("?minFollowers=nope&limit=50")).total).toBe(open);
    expect((await list("?minFollowers=-5&limit=50")).total).toBe(open);
  });
});

describe("GET /api/prospects shuffle", () => {
  const deck = ["deck_a", "deck_b", "deck_c", "deck_d", "deck_e"].map((username) => ({
    username,
    platform: "instagram",
  }));
  const rank = (id: number, seed: number) =>
    Number((BigInt(id) * BigInt(SHUFFLE_MULTIPLIER) + BigInt(seed)) & BigInt(SHUFFLE_MASK));
  const byRank = (items: Array<Record<string, any>>, seed: number) =>
    [...items].sort((a, b) => rank(a.id, seed) - rank(b.id, seed) || a.id - b.id);
  const loadDeck = () => importRows(deck);

  it("pages through one frozen order for a seed", async () => {
    await loadDeck();
    const full = await list("?q=deck_&sort=shuffle&seed=42&limit=50");
    expect(full.total).toBe(5);
    expect(full.items.map((p) => p.id)).toEqual(byRank(full.items, 42).map((p) => p.id));

    const pages = [];
    for (const offset of [0, 2, 4]) {
      const page = await list(`?q=deck_&sort=shuffle&seed=42&limit=2&offset=${offset}`);
      pages.push(...page.items);
    }
    expect(pages.map((p) => p.id)).toEqual(full.items.map((p) => p.id));

    const again = await list("?q=deck_&sort=shuffle&seed=42&limit=50");
    expect(again.items.map((p) => p.id)).toEqual(full.items.map((p) => p.id));
  });

  it("treats a missing or unusable seed as 0", async () => {
    await loadDeck();
    const ids = async (query: string) => (await list(query)).items.map((p) => p.id);
    const zero = await ids("?q=deck_&sort=shuffle&seed=0&limit=50");
    expect(await ids("?q=deck_&sort=shuffle&limit=50")).toEqual(zero);
    expect(await ids("?q=deck_&sort=shuffle&seed=nope&limit=50")).toEqual(zero);
    expect(await ids("?q=deck_&sort=shuffle&seed=-3&limit=50")).toEqual(zero);
    expect(await ids("?q=deck_&sort=shuffle&seed=9999999999&limit=50")).toEqual(zero);
  });

  it("uses the seed's order and keeps the same people", async () => {
    await loadDeck();
    const a = await list("?q=deck_&sort=shuffle&seed=42&limit=50");
    const b = await list("?q=deck_&sort=shuffle&seed=99&limit=50");
    expect(b.items.map((p) => p.username).sort()).toEqual(a.items.map((p) => p.username).sort());
    expect(b.items.map((p) => p.id)).toEqual(byRank(b.items, 99).map((p) => p.id));
  });
});

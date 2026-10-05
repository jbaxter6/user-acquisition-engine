import { describe, expect, it } from "vitest";
import { useTestServer } from "../test/harness.js";

const { api } = useTestServer();

describe("message templates", () => {
  let templateId: number;

  it("requires a name and body", async () => {
    expect((await api("/api/templates", { method: "POST", json: { name: "x" } })).status).toBe(400);
  });

  it("creates, lists and edits a template", async () => {
    const created = await api("/api/templates", { method: "POST", json: { name: " Opener ", body: " Hey! " } });
    expect(created.status).toBe(201);
    const template = await created.json();
    templateId = template.id;
    expect(template).toMatchObject({ name: "Opener", body: "Hey!", tags: [], authors: [] });

    const edited = await api(`/api/templates/${templateId}`, {
      method: "PUT",
      json: { name: "Opener v2", body: "Hey there!", tags: [" Opener ", "opener", "Follow up"] },
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ tags: ["Opener", "Follow up"] });
    const all = await (await api("/api/templates")).json();
    expect(all).toMatchObject([{ id: templateId, name: "Opener v2", tags: ["Opener", "Follow up"] }]);
  });

  it("rejects a tag list that isn't tags", async () => {
    const res = await api("/api/templates", { method: "POST", json: { name: "Bad", body: "Hi", tags: "opener" } });
    expect(res.status).toBe(400);
  });

  it("stores John and Justin, and rejects anyone else", async () => {
    const created = await api("/api/templates", {
      method: "POST",
      json: { name: "Shared", body: "Hi", authors: ["Justin", "john"] },
    });
    expect(created.status).toBe(201);
    const shared = await created.json();
    expect(shared).toMatchObject({ authors: ["john", "justin"] });
    await api(`/api/templates/${shared.id}`, { method: "DELETE" });

    const bad = await api("/api/templates", {
      method: "POST",
      json: { name: "Nope", body: "Hi", authors: ["alex"] },
    });
    expect(bad.status).toBe(400);
  });

  it("404s when editing a template that doesn't exist", async () => {
    expect((await api("/api/templates/9999", { method: "PUT", json: { name: "a", body: "b" } })).status).toBe(404);
  });

  it("counts sends in stats and locks a template once it's been sent", async () => {
    await api("/api/prospects/bulk", { method: "POST", json: { prospects: [{ username: "delta", platform: "tiktok" }] } });
    const { items } = await (await api("/api/prospects")).json();
    await api(`/api/prospects/${items[0].id}/mark-contacted`, {
      method: "POST",
      json: { text: "Hey there!", templateId },
    });

    const stats = await (await api("/api/templates/stats")).json();
    expect(stats.find((t: { id: number }) => t.id === templateId)).toMatchObject({ sent: 1, replied: 0, reply_rate: 0 });

    const edit = await api(`/api/templates/${templateId}`, { method: "PUT", json: { name: "x", body: "y" } });
    expect(edit.status).toBe(409);

    const retag = await api(`/api/templates/${templateId}`, {
      method: "PUT",
      json: { name: "Opener v2", body: "Hey there!", tags: ["Opener", "soft"] },
    });
    expect(retag.status).toBe(200);
    expect(await retag.json()).toMatchObject({ tags: ["Opener", "soft"] });
    const statsAfter = await (await api("/api/templates/stats")).json();
    expect(statsAfter.find((t: { id: number }) => t.id === templateId).tags).toEqual(["Opener", "soft"]);

    const reauthor = await api(`/api/templates/${templateId}`, {
      method: "PUT",
      json: { name: "Opener v2", body: "Hey there!", authors: ["justin"] },
    });
    expect(reauthor.status).toBe(200);
    expect(await reauthor.json()).toMatchObject({ tags: ["Opener", "soft"], authors: ["justin"] });
  });

  it("archives instead of deleting", async () => {
    await api(`/api/templates/${templateId}`, { method: "DELETE" });
    expect(await (await api("/api/templates")).json()).toEqual([]);
    const withArchived = await (await api("/api/templates?includeArchived=true")).json();
    expect(withArchived[0].archived_at).toBeTruthy();
  });
});

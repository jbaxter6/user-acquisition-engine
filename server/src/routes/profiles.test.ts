import { describe, expect, it } from "vitest";
import { useTestServer } from "../test/harness.js";

const { api } = useTestServer();

const followerRange = { id: "c1", mode: "required", attribute: "followers", operator: "between", value: [10000, 100000] };

describe("profiles", () => {
  it("serves the attribute registry, filtered by platform", async () => {
    const all = await (await api("/api/profiles/attributes")).json();
    const ig = await (await api("/api/profiles/attributes?platform=instagram")).json();
    expect(all.attributes.length).toBeGreaterThan(0);
    expect(ig.attributes.every((a: { platforms: string[] }) => a.platforms.includes("instagram"))).toBe(true);
    expect((await api("/api/profiles/attributes?platform=myspace")).status).toBe(400);
  });

  it("explains every validation problem at once", async () => {
    const res = await api("/api/profiles", { method: "POST", json: { name: "", platform: "myspace", color: "red" } });
    expect(res.status).toBe(400);
    const { errors } = await res.json();
    expect(errors).toEqual(
      expect.arrayContaining(["name is required", expect.stringMatching(/^platform must be/), "color must be a #rrggbb hex"]),
    );
  });

  let id: number;

  it("creates and reads back a profile", async () => {
    const res = await api("/api/profiles", {
      method: "POST",
      json: { name: "Mid-tier IG", platform: "instagram", criteria: [followerRange], color: "#ff8800" },
    });
    expect(res.status).toBe(201);
    id = (await res.json()).id;
    expect(await (await api(`/api/profiles/${id}`)).json()).toMatchObject({
      name: "Mid-tier IG",
      platform: "instagram",
      criteria: [followerRange],
    });
    expect((await api("/api/profiles/9999")).status).toBe(404);
  });

  it("refuses to change a profile once created", async () => {
    const res = await api(`/api/profiles/${id}`, {
      method: "PUT",
      json: { name: "Renamed", platform: "instagram", criteria: [] },
    });
    expect(res.status).toBe(405);
    expect((await (await api(`/api/profiles/${id}`)).json()).name).toBe("Mid-tier IG");
  });

  it("archives and restores", async () => {
    await api(`/api/profiles/${id}`, { method: "DELETE" });
    const active = await (await api("/api/profiles")).json();
    expect(active.map((p: { id: number }) => p.id)).not.toContain(id);
    const everything = await (await api("/api/profiles?includeArchived=true")).json();
    expect(everything.map((p: { id: number }) => p.id)).toContain(id);

    await api(`/api/profiles/${id}/restore`, { method: "POST" });
    const back = await (await api("/api/profiles")).json();
    expect(back.map((p: { id: number }) => p.id)).toContain(id);
  });

  it("counts matching prospects, filtered by status", async () => {
    await api("/api/prospects/bulk", {
      method: "POST",
      json: {
        prospects: [
          { username: "fits", platform: "instagram", followers: 50_000 },
          { username: "too_small", platform: "instagram", attributes: { followers: 500 } },
          { username: "no_data", platform: "instagram" },
          { username: "wrong_platform", platform: "tiktok", followers: 50_000 },
        ],
      },
    });

    const summary = await (await api(`/api/profiles/${id}/summary`)).json();
    expect(summary).toEqual({
      match: 1,
      possible: 1,
      total: 3,
      criteria: { c1: { pass: 1, fail: 1, unknown: 1 } },
    });

    const contacted = await (await api(`/api/profiles/${id}/summary?status=contacted`)).json();
    expect(contacted).toMatchObject({ match: 0, possible: 0, total: 0 });
    expect((await api(`/api/profiles/${id}/summary?status=bogus`)).status).toBe(400);
    expect((await api("/api/profiles/9999/summary")).status).toBe(404);

    const all = await (await api("/api/profiles/summaries")).json();
    expect(all[id]).toEqual({ match: 1, possible: 1, total: 3 });
  });
});

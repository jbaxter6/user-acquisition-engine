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

  it("duplicates a profile", async () => {
    const res = await api(`/api/profiles/${id}/duplicate`, { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Mid-tier IG (copy)", criteria: [followerRange] });
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

  it("refuses a platform change that would orphan criteria", async () => {
    const onlyOnInstagram = (await (await api("/api/profiles/attributes")).json()).attributes.find(
      (a: { platforms: string[] }) => a.platforms.includes("instagram") && !a.platforms.includes("twitch"),
    );
    expect(onlyOnInstagram).toBeTruthy();
    const criterion = { ...followerRange, id: "c2", attribute: onlyOnInstagram.key };
    const created = await (
      await api("/api/profiles", { method: "POST", json: { name: "IG only", platform: "instagram", criteria: [] } })
    ).json();

    const res = await api(`/api/profiles/${created.id}`, {
      method: "PUT",
      json: { name: "IG only", platform: "twitch", criteria: [criterion] },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).incompatible).toEqual(["c2"]);
  });
});

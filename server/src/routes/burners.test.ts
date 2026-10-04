import { describe, expect, it } from "vitest";
import { useTestServer } from "../test/harness.js";

const { api } = useTestServer({ BURNER_CREDENTIALS_KEY: "test-burner-key" });

describe("burner accounts", () => {
  it("requires a platform, username, and password", async () => {
    expect((await api("/api/burners", { method: "POST", json: { username: "a" } })).status).toBe(400);
    expect(
      (await api("/api/burners", { method: "POST", json: { platform: "instagram", username: "a" } })).status,
    ).toBe(400);
  });

  it("refuses a Smooth account", async () => {
    const res = await api("/api/burners", {
      method: "POST",
      json: { platform: "instagram", username: "@MoveWithSmooth", password: "nope" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Smooth account/) });
  });

  it("saves a throwaway and only returns the password on the detail route", async () => {
    const created = await api("/api/burners", {
      method: "POST",
      json: {
        platform: "instagram",
        username: " @Throw.Away ",
        password: "s3cret",
        email: "throw@example.com",
        notes: "WAR browser",
      },
    });
    expect(created.status).toBe(201);
    const row = await created.json();
    expect(row).toMatchObject({
      platform: "instagram",
      username: "throw.away",
      email: "throw@example.com",
      notes: "WAR browser",
    });
    expect(row.password).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("s3cret");

    const list = await (await api("/api/burners")).json();
    expect(list).toEqual([expect.objectContaining({ id: row.id, username: "throw.away" })]);
    expect(JSON.stringify(list)).not.toContain("s3cret");

    const detail = await (await api(`/api/burners/${row.id}`)).json();
    expect(detail.password).toBe("s3cret");
    expect(detail.password_enc).toBeUndefined();
  });

  it("keeps the password when an edit omits it, and replaces it when one is sent", async () => {
    const { id } = await (
      await api("/api/burners", {
        method: "POST",
        json: { platform: "tiktok", username: "clipper", password: "first" },
      })
    ).json();

    const edited = await api(`/api/burners/${id}`, {
      method: "PUT",
      json: { platform: "tiktok", username: "clipper", notes: "updated" },
    });
    expect(edited.status).toBe(200);
    expect((await (await api(`/api/burners/${id}`)).json()).password).toBe("first");

    await api(`/api/burners/${id}`, {
      method: "PUT",
      json: { platform: "tiktok", username: "clipper", password: "second" },
    });
    expect((await (await api(`/api/burners/${id}`)).json()).password).toBe("second");
  });

  it("rejects a duplicate handle on the same platform", async () => {
    const again = await api("/api/burners", {
      method: "POST",
      json: { platform: "instagram", username: "throw.away", password: "other" },
    });
    expect(again.status).toBe(409);
  });

  it("deletes a burner", async () => {
    const { id } = await (
      await api("/api/burners", {
        method: "POST",
        json: { platform: "twitch", username: "gone", password: "x" },
      })
    ).json();
    expect((await api(`/api/burners/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/burners/${id}`)).status).toBe(404);
  });
});

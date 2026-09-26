import { describe, expect, it } from "vitest";
import { useTestServer } from "../test/harness.js";

// The whole app sits behind SITE_PASSWORD in production.
const { api, clearCookies } = useTestServer({ SITE_PASSWORD: "hunter2" });

describe("site password gate", () => {
  it("keeps the health check public for the host's probes", async () => {
    expect((await api("/api/health")).status).toBe(200);
  });

  it("blocks the API and OAuth routes without a session", async () => {
    expect((await api("/api/prospects")).status).toBe(401);
    expect((await api("/auth/instagram/accounts")).status).toBe(401);
    expect(await (await api("/api/session")).json()).toEqual({ required: true, authenticated: false });
  });

  it("keeps Meta's webhook reachable without a session", async () => {
    const res = await api("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=abc");
    expect(res.status).toBe(200);
  });

  it("rejects a wrong password", async () => {
    const res = await api("/api/session/login", { method: "POST", json: { password: "nope" } });
    expect(res.status).toBe(401);
  });

  it("signs in with the right password, and out again", async () => {
    const login = await api("/api/session/login", { method: "POST", json: { password: "hunter2" } });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toMatch(/smooth_session=.+HttpOnly/);
    expect((await api("/api/prospects")).status).toBe(200);
    expect(await (await api("/api/session")).json()).toEqual({ required: true, authenticated: true });

    await api("/api/session/logout", { method: "POST" });
    expect((await api("/api/prospects")).status).toBe(401);
  });

  it("rejects a forged session cookie", async () => {
    clearCookies();
    const res = await api("/api/prospects", { headers: { Cookie: `smooth_session=${Date.now() + 1e9}.deadbeef` } });
    expect(res.status).toBe(401);
  });

  // Last: the lockout also blocks the correct password for a minute.
  it("locks out after 5 wrong passwords", async () => {
    for (let i = 0; i < 5; i++) {
      await api("/api/session/login", { method: "POST", json: { password: "wrong" } });
    }
    const res = await api("/api/session/login", { method: "POST", json: { password: "hunter2" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

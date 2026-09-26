import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { createApp } from "../app.js";

export interface TestServer {
  /** fetch against the app: `api("/api/health")`. Keeps the session cookie. */
  api: (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
  /** Forget the session cookie (sign out). */
  clearCookies: () => void;
}

/**
 * Starts the real app on a random port for the current test file.
 * `env` is applied before the app is built (e.g. SITE_PASSWORD).
 */
export function useTestServer(env: Record<string, string> = {}): TestServer {
  let server: Server;
  let base = "";
  let cookie = "";

  beforeAll(async () => {
    Object.assign(process.env, env);
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  return {
    api: async (path, init = {}) => {
      const { json, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (json !== undefined) headers.set("Content-Type", "application/json");
      if (cookie) headers.set("Cookie", cookie);
      const res = await realFetch(`${base}${path}`, {
        ...rest,
        headers,
        body: json !== undefined ? JSON.stringify(json) : rest.body,
        redirect: "manual",
      });
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
      return res;
    },
    clearCookies: () => {
      cookie = "";
    },
  };
}

const realFetch = globalThis.fetch.bind(globalThis);

export interface MetaCall {
  method: string;
  url: URL;
  body: string | undefined;
}

/**
 * Fakes Meta's API for the current test file. Any request to an
 * instagram.com host goes to `handler` instead of the network; everything
 * else (the test's own requests to the app) passes through. Returns the log
 * of Meta calls, cleared after each test.
 */
export function useFakeMeta(handler: (call: MetaCall) => Response | Promise<Response>): MetaCall[] {
  const calls: MetaCall[] = [];
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!/(^|\.)instagram\.com$/.test(url.hostname)) return realFetch(input, init);
      const call = { method: init?.method ?? "GET", url, body: init?.body ? String(init.body) : undefined };
      calls.push(call);
      return handler(call);
    });
  });
  afterEach(() => {
    calls.length = 0;
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });
  return calls;
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

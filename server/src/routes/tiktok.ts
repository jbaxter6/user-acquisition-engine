import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { upsertAccount } from "../db.js";

// UNVERIFIED against TikTok's current docs: this follows the TikTok API for
// Business (Marketing API) authorization flow — portal auth URL, then an
// auth_code exchanged at /oauth2/access_token/. The Business Messaging API
// may use a different authorization page or scopes. The raw exchange
// response is logged (token redacted) so the first real connect shows what
// TikTok actually returns.
const AUTH_URL = "https://business-api.tiktok.com/portal/auth";
const TOKEN_URL =
  "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/";
const STATE_TTL_MS = 10 * 60 * 1000;

// In-memory CSRF states, same approach as routes/auth.ts (single process).
const pendingStates = new Map<string, number>();

function pruneExpiredStates() {
  const now = Date.now();
  for (const [state, issuedAt] of pendingStates) {
    if (now - issuedAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to server/.env.`);
  return value;
}

function redirectUri(): string {
  return (
    process.env.TIKTOK_REDIRECT_URI ??
    "http://localhost:4000/auth/tiktok/callback"
  );
}

function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:5173";
}

interface TokenResponse {
  code: number;
  message?: string;
  data?: {
    access_token?: string;
    advertiser_ids?: string[];
    scope?: unknown;
  };
}

// Mounted behind the site password (starts the flow from the signed-in app).
export function tiktokLoginRouter(): Router {
  const router = Router();

  router.get("/login", (_req, res) => {
    let appId: string;
    try {
      appId = requireEnv("TIKTOK_APP_ID");
    } catch (err) {
      return res.status(500).send((err as Error).message);
    }

    pruneExpiredStates();
    const state = crypto.randomUUID();
    pendingStates.set(state, Date.now());

    const url = new URL(AUTH_URL);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri());
    res.redirect(url.toString());
  });

  return router;
}

// Mounted BEFORE the site password gate: TikTok's redirect (and reviewers)
// must be able to reach it. It's inert without a state issued by /login,
// so an unauthenticated visitor can't connect anything.
export async function tiktokCallback(req: Request, res: Response) {
  const {
    auth_code,
    code,
    state,
    error,
    error_description,
  } = req.query as Record<string, string | undefined>;
  const authCode = auth_code ?? code;
  const fail = (reason: string) =>
    res.redirect(
      `${clientUrl()}/?tiktok=error&reason=${encodeURIComponent(reason)}`,
    );

  if (error) return fail(error_description ?? error);
  if (!authCode || !state || !pendingStates.has(state))
    return fail("invalid_state");
  pendingStates.delete(state);

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: requireEnv("TIKTOK_APP_ID"),
        secret: requireEnv("TIKTOK_APP_SECRET"),
        auth_code: authCode,
      }),
    });
    const raw = (await tokenRes.json()) as TokenResponse;
    console.log(
      "TikTok token exchange response:",
      JSON.stringify({
        ...raw,
        data: raw.data && {
          ...raw.data,
          access_token: raw.data.access_token ? "(redacted)" : undefined,
        },
      }),
    );

    if (!tokenRes.ok || raw.code !== 0 || !raw.data?.access_token) {
      throw new Error(
        `token exchange failed: ${raw.message ?? tokenRes.statusText}`,
      );
    }

    // Marketing API returns the advertiser ids the user granted; used as
    // the external id until the messaging API tells us the account's own id.
    const externalId = raw.data.advertiser_ids?.[0];
    if (!externalId)
      throw new Error(
        "TikTok returned no account id — check the response logged above.",
      );

    upsertAccount({
      platform: "tiktok",
      igUserId: externalId,
      accessToken: raw.data.access_token,
    });

    res.redirect(`${clientUrl()}/?tiktok=connected`);
  } catch (err) {
    fail((err as Error).message);
  }
}

import { Router } from "express";
import crypto from "node:crypto";
import { deleteAccount, getAccountById, listAccounts, upsertAccount } from "../db.js";
import { syncInstagramAccount } from "../sync.js";

const GRAPH_API_VERSION = "v21.0";
const STATE_TTL_MS = 10 * 60 * 1000;

// In-memory CSRF-state store for the OAuth dialog round trip. Fine for a
// single-process local/internal tool; would need a shared store (Redis,
// DB) behind a load balancer.
const pendingStates = new Map<string, number>();

function pruneExpiredStates() {
  const now = Date.now();
  for (const [state, issuedAt] of pendingStates) {
    if (now - issuedAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Set it in server/.env with the Instagram App ID/Secret from the "API setup with Instagram login" page — see README "Instagram Setup".`
    );
  }
  return value;
}

function redirectUri(): string {
  return process.env.OAUTH_REDIRECT_URI ?? "http://localhost:4000/auth/instagram/callback";
}

function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:5173";
}

interface ShortLivedTokenResponse {
  data: Array<{ access_token: string; user_id: string; permissions: string }>;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ProfileResponse {
  user_id: string;
  username: string;
  profile_picture_url?: string;
}

export function authRouter(): Router {
  const router = Router();

  // Lists every connected account (main + satellites) feeding the inbox.
  router.get("/instagram/accounts", (_req, res) => {
    const accounts = listAccounts("instagram").map((a) => ({
      id: a.id,
      username: a.username,
      igUserId: a.ig_user_id,
      profilePictureUrl: a.profile_picture_url,
      connectedAt: a.connected_at,
    }));
    res.json(accounts);
  });

  router.delete("/instagram/accounts/:id", (req, res) => {
    deleteAccount(Number(req.params.id));
    res.json({ ok: true });
  });

  // Pulls conversation/message history directly via the Graph API,
  // independent of webhook push — see server/src/sync.ts for why this
  // exists (webhook delivery appears gated behind App Review even for
  // tester-to-tester conversations).
  router.post("/instagram/accounts/:id/sync", async (req, res) => {
    const account = getAccountById(Number(req.params.id));
    if (!account) return res.status(404).json({ error: "account not found" });

    try {
      const result = await syncInstagramAccount(account);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Kicks off the OAuth dialog. Call repeatedly — once per satellite
  // account — to connect each one; each completion adds a new row rather
  // than replacing the last connected account.
  router.get("/instagram/login", (req, res) => {
    let appId: string;
    try {
      appId = requireEnv("INSTAGRAM_APP_ID");
    } catch (err) {
      return res.status(500).send((err as Error).message);
    }

    pruneExpiredStates();
    const state = crypto.randomUUID();
    pendingStates.set(state, Date.now());

    const scope = ["instagram_business_basic", "instagram_business_manage_messages"].join(",");

    const authorizeUrl = new URL("https://www.instagram.com/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", appId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri());
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", scope);
    authorizeUrl.searchParams.set("response_type", "code");

    res.redirect(authorizeUrl.toString());
  });

  router.get("/instagram/callback", async (req, res) => {
    const { code: rawCode, state, error, error_description } = req.query as Record<string, string | undefined>;

    if (error) {
      return res.redirect(`${clientUrl()}/?instagram=error&reason=${encodeURIComponent(error_description ?? error)}`);
    }
    if (!rawCode || !state || !pendingStates.has(state)) {
      return res.redirect(`${clientUrl()}/?instagram=error&reason=invalid_state`);
    }
    pendingStates.delete(state);

    // Instagram appends a `#_` fragment to the code Meta redirects back with.
    const code = rawCode.replace(/#_$/, "");

    try {
      const appId = requireEnv("INSTAGRAM_APP_ID");
      const appSecret = requireEnv("INSTAGRAM_APP_SECRET");

      // 1. Exchange the auth code for a short-lived Instagram user token.
      const form = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
        code,
      });
      const shortLivedRes = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        body: form,
      });
      if (!shortLivedRes.ok) throw new Error(`code exchange failed: ${await shortLivedRes.text()}`);
      const shortLivedRaw = (await shortLivedRes.json()) as ShortLivedTokenResponse | { access_token: string };
      console.log("Instagram short-lived token exchange response:", JSON.stringify(shortLivedRaw));
      // Meta's docs describe this as `{ data: [{ access_token, ... }] }`, but
      // some app configs return the token object directly — handle both.
      const shortLivedToken =
        "data" in shortLivedRaw ? shortLivedRaw.data[0]?.access_token : shortLivedRaw.access_token;
      if (!shortLivedToken) {
        throw new Error(`unexpected token exchange response shape: ${JSON.stringify(shortLivedRaw)}`);
      }

      // 2. Exchange for a long-lived token (~60 days).
      const longLivedUrl = new URL("https://graph.instagram.com/access_token");
      longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
      longLivedUrl.searchParams.set("client_secret", appSecret);
      longLivedUrl.searchParams.set("access_token", shortLivedToken);
      const longLivedRes = await fetch(longLivedUrl);
      if (!longLivedRes.ok) throw new Error(`token exchange failed: ${await longLivedRes.text()}`);
      const { access_token: longLivedToken } = (await longLivedRes.json()) as LongLivedTokenResponse;

      // 3. Look up the connected account's own profile (id, username, avatar).
      const profileUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/me`);
      profileUrl.searchParams.set("fields", "user_id,username,profile_picture_url");
      profileUrl.searchParams.set("access_token", longLivedToken);
      const profileRes = await fetch(profileUrl);
      if (!profileRes.ok) throw new Error(`profile lookup failed: ${await profileRes.text()}`);
      const profile = (await profileRes.json()) as ProfileResponse;

      upsertAccount({
        igUserId: profile.user_id,
        username: profile.username,
        profilePictureUrl: profile.profile_picture_url,
        accessToken: longLivedToken,
      });

      // 4. Subscribe this specific account to webhook events. Configuring a
      // callback URL at the app level (dashboard step 3) is not enough —
      // each connected account has to opt in separately, or Meta never
      // sends its messages to the webhook at all.
      const subscribeUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/${profile.user_id}/subscribed_apps`);
      subscribeUrl.searchParams.set("subscribed_fields", "messages");
      subscribeUrl.searchParams.set("access_token", longLivedToken);
      const subscribeRes = await fetch(subscribeUrl, { method: "POST" });
      if (!subscribeRes.ok) {
        console.error(`Webhook subscription failed for @${profile.username}:`, await subscribeRes.text());
      } else {
        console.log(`Subscribed @${profile.username} to Instagram webhook messages.`);
      }

      res.redirect(`${clientUrl()}/?instagram=connected&username=${encodeURIComponent(profile.username)}`);
    } catch (err) {
      res.redirect(`${clientUrl()}/?instagram=error&reason=${encodeURIComponent((err as Error).message)}`);
    }
  });

  return router;
}

import crypto from "node:crypto";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "smooth_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths, which itself leaks length
  // info via a fast-path — pad to equal length first so the comparison
  // always takes the same code path regardless of input.
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.concat([bufA], maxLen);
  const paddedB = Buffer.concat([bufB], maxLen);
  return (
    crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length
  );
}

// Tokens are signed with a key derived from the password, so changing
// SITE_PASSWORD signs everyone out.
function sign(password: string, payload: string): string {
  return crypto
    .createHmac("sha256", `smooth-session:${password}`)
    .update(payload)
    .digest("hex");
}

function makeToken(password: string): string {
  const expires = String(Date.now() + SESSION_TTL_MS);
  return `${expires}.${sign(password, expires)}`;
}

function tokenIsValid(password: string, token: string | undefined): boolean {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (!(Number(expires) > Date.now())) return false;
  return timingSafeEqualStr(signature, sign(password, expires));
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // `req.secure` is honest behind Railway's proxy because index.ts sets
  // `trust proxy`; plain http (local dev) still works without it.
  if (req.secure) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

function hasBasicAuth(req: Request, password: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  const provided =
    separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;
  return timingSafeEqualStr(provided, password);
}

function isAuthenticated(req: Request, password: string): boolean {
  return (
    tokenIsValid(password, readCookie(req, COOKIE_NAME)) ||
    hasBasicAuth(req, password)
  );
}

// Failed-login throttle, per client IP (in-memory: fine for one process).
const failures = new Map<string, { count: number; lockedUntil: number }>();

/**
 * Session endpoints for the in-app login page. Mount before `siteAuth()`.
 *   GET  /api/session         -> { required, authenticated }
 *   POST /api/session/login   -> { password }, sets the session cookie
 *   POST /api/session/logout  -> clears it
 */
export function sessionRouter(): Router {
  const router = Router();
  const password = process.env.SITE_PASSWORD;

  router.get("/", (req, res) => {
    res.json({
      required: Boolean(password),
      authenticated: !password || isAuthenticated(req, password),
    });
  });

  router.post("/login", (req, res) => {
    if (!password) return res.json({ ok: true });

    const key = req.ip ?? "unknown";
    const entry = failures.get(key);
    if (entry && entry.lockedUntil > Date.now()) {
      const retryAfter = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: `Too many attempts. Try again in ${retryAfter}s.`,
      });
    }

    const provided = (req.body as { password?: unknown })?.password;
    if (typeof provided !== "string" || !timingSafeEqualStr(provided, password)) {
      const count = (entry?.count ?? 0) + 1;
      failures.set(key, {
        count,
        lockedUntil: count >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
      });
      if (count >= MAX_FAILED_ATTEMPTS) failures.set(key, { count: 0, lockedUntil: Date.now() + LOCKOUT_MS });
      return res.status(401).json({ error: "Incorrect password." });
    }

    failures.delete(key);
    setSessionCookie(req, res, makeToken(password), SESSION_TTL_MS);
    res.json({ ok: true });
  });

  router.post("/logout", (req, res) => {
    setSessionCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  return router;
}

/**
 * Gates the API and OAuth routes behind the shared password. The static app
 * shell stays public (it holds no data) so the login page can render; every
 * /api and /auth request needs a valid session cookie, or Basic Auth for
 * scripts. If SITE_PASSWORD isn't set the gate is disabled (local dev).
 * Mount AFTER routes that must stay reachable without a session — Meta's
 * webhooks, the privacy policy, and the TikTok OAuth callback.
 */
export function siteAuth() {
  const password = process.env.SITE_PASSWORD;

  return (req: Request, res: Response, next: NextFunction) => {
    if (!password) return next();
    const protectedPath =
      req.path.startsWith("/api/") || req.path.startsWith("/auth/");
    if (!protectedPath) return next();
    // Health checks must stay reachable for the host's probes.
    if (req.path === "/api/health") return next();
    if (isAuthenticated(req, password)) return next();

    res.status(401).json({ error: "auth_required" });
  };
}

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths, which itself leaks length
  // info via a fast-path — pad to equal length first so the comparison
  // always takes the same code path regardless of input.
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.concat([bufA], maxLen);
  const paddedB = Buffer.concat([bufB], maxLen);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

/**
 * Gates the whole site behind a single shared password via HTTP Basic Auth.
 * The username is ignored — only the password is checked. Basic Auth is
 * used (rather than a login page + session) specifically because browsers
 * cache the credentials per-origin and attach them to every subsequent
 * request, including fetch() calls from the React app — no frontend
 * changes needed for API calls to stay authenticated after the first
 * prompt.
 *
 * If SITE_PASSWORD isn't set, the gate is disabled entirely (useful for
 * local dev). Mount this AFTER any routes that must stay reachable
 * without a browser session — e.g. Meta's webhook POSTs, which come from
 * their servers and never carry these credentials.
 */
export function siteAuth() {
  const password = process.env.SITE_PASSWORD;

  return (req: Request, res: Response, next: NextFunction) => {
    if (!password) return next();

    const header = req.headers.authorization;
    if (header?.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const separatorIndex = decoded.indexOf(":");
      const providedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;
      if (timingSafeEqualStr(providedPassword, password)) {
        return next();
      }
    }

    res.set("WWW-Authenticate", 'Basic realm="Smooth Outreach Engine"');
    res.status(401).send("Authentication required");
  };
}

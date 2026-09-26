import { markAccountTokenInvalid, recordMetaCall, saveMetaUsageReading } from "../db.js";
import {
  isInvalidTokenResponse,
  isThrottleResponse,
  parseUsageHeaders,
  type MetaCallKind,
} from "./usage.js";

let loggedHeaderShape = false;

/**
 * The only way the server should talk to Meta. Behaves exactly like
 * `fetch`, but also counts the call and stores Meta's reported usage for
 * the account, which feeds the navbar usage meter (GET /api/meta/usage).
 * `accountId` is null only for OAuth calls made before the account row
 * exists.
 */
export async function metaFetch(
  accountId: number | null,
  kind: MetaCallKind,
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, init);

  // Bookkeeping must never break the actual call.
  try {
    const errorBody = res.ok ? "" : await res.clone().text();
    const throttled = res.status === 429 || (!res.ok && isThrottleResponse(res.status, errorBody));
    const reading = parseUsageHeaders(res.headers);

    // Once per process, show which usage headers Meta actually sends on
    // this API, so the parsing in usage.ts can be checked against reality.
    if (!loggedHeaderShape) {
      loggedHeaderShape = true;
      const usageHeaders = [...res.headers.entries()].filter(([name]) => /usage/i.test(name));
      console.log(
        "Meta usage headers seen:",
        usageHeaders.length ? Object.fromEntries(usageHeaders) : "(none)",
      );
    }

    recordMetaCall({ accountId, kind, status: res.status, throttled });
    if (reading && accountId !== null) saveMetaUsageReading(accountId, reading);
    // Flag the account so the UI asks for a reconnect; cleared when the
    // account goes through the OAuth flow again (upsertAccount).
    if (!res.ok && accountId !== null && isInvalidTokenResponse(errorBody)) {
      markAccountTokenInvalid(accountId);
      console.warn(`Meta rejected the access token for account ${accountId}; it needs reconnecting.`);
    }
    if (throttled) console.warn(`Meta throttled a ${kind} call (account ${accountId ?? "none"}), status ${res.status}.`);
  } catch (err) {
    console.error("Recording Meta API usage failed:", err);
  }

  return res;
}

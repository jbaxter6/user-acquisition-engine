// Pure helpers for the Meta API usage meter — see
// docs/meta-api-usage-meter.md. No DB or network here so it's testable.

export type MetaCallKind =
  | "auth"
  | "profile"
  | "send"
  | "sync.list"
  | "sync.thread"
  | "sync.message";

export interface MetaUsageReading {
  callCountPct: number | null;
  totalTimePct: number | null;
  totalCputimePct: number | null;
  regainAccessMinutes: number | null;
}

export type UsageLevel = "ok" | "warn" | "over";

// Meta's throttling error codes: 4 app-level, 17 user-level, 32 page-level,
// 613 custom rate limit, 80002 Instagram business use case.
const THROTTLE_ERROR_CODES = new Set([4, 17, 32, 613, 80002]);

// Headers Meta reports utilization in. Which one graph.instagram.com sends
// is still to be confirmed from real responses (metaFetch logs them), so
// read every known shape and keep the worst value.
const USAGE_HEADERS = ["x-business-use-case-usage", "x-app-usage"];

interface RawUsage {
  call_count?: number;
  total_time?: number;
  total_cputime?: number;
  estimated_time_to_regain_access?: number;
}

// X-App-Usage is one flat object; X-Business-Use-Case-Usage is
// `{ "<business id>": [ {...}, ... ] }`. Flatten both to a list.
function rawEntries(parsed: unknown): RawUsage[] {
  if (!parsed || typeof parsed !== "object") return [];
  if ("call_count" in parsed || "total_time" in parsed || "total_cputime" in parsed) {
    return [parsed as RawUsage];
  }
  return Object.values(parsed).flatMap((v) => (Array.isArray(v) ? (v as RawUsage[]) : []));
}

function maxOf(values: Array<number | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
}

export function parseUsageHeaders(headers: Headers): MetaUsageReading | null {
  const entries = USAGE_HEADERS.flatMap((name) => {
    const value = headers.get(name);
    if (!value) return [];
    try {
      return rawEntries(JSON.parse(value));
    } catch {
      return [];
    }
  });
  if (entries.length === 0) return null;
  return {
    callCountPct: maxOf(entries.map((e) => e.call_count)),
    totalTimePct: maxOf(entries.map((e) => e.total_time)),
    totalCputimePct: maxOf(entries.map((e) => e.total_cputime)),
    regainAccessMinutes: maxOf(entries.map((e) => e.estimated_time_to_regain_access)),
  };
}

/** True when a response means Meta is rate limiting us. */
export function isThrottleResponse(status: number, body: string): boolean {
  if (status === 429) return true;
  try {
    const code = (JSON.parse(body) as { error?: { code?: number } }).error?.code;
    return code !== undefined && THROTTLE_ERROR_CODES.has(code);
  } catch {
    return false;
  }
}

/**
 * True when Meta says the access token is no longer valid (code 190:
 * expired, password changed, or the session was revoked). The account
 * has to be reconnected through the OAuth flow.
 */
export function isInvalidTokenResponse(body: string): boolean {
  try {
    return (JSON.parse(body) as { error?: { code?: number } }).error?.code === 190;
  } catch {
    return false;
  }
}

export interface UsageThresholds {
  metaPctWarn: number;
  metaPctOver: number;
  sendsWarn: number;
  sendsOver: number;
}

export function usageThresholds(env: NodeJS.ProcessEnv = process.env): UsageThresholds {
  const num = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value && Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    metaPctWarn: 50,
    metaPctOver: 80,
    sendsWarn: num(env.META_SENDS_WARN, 30),
    sendsOver: num(env.META_SENDS_MAX, 60),
  };
}

export function highestPct(reading: MetaUsageReading | null): number | null {
  if (!reading) return null;
  return maxOf([
    reading.callCountPct ?? undefined,
    reading.totalTimePct ?? undefined,
    reading.totalCputimePct ?? undefined,
  ]);
}

/** Worst of: Meta's reported %, recent throttling, and our send pace. */
export function usageLevel(
  input: {
    metaPct: number | null;
    throttledLastHour: number;
    throttledLast24h: number;
    sendsLastHour: number;
  },
  t: UsageThresholds,
): UsageLevel {
  if (
    (input.metaPct ?? 0) >= t.metaPctOver ||
    input.throttledLastHour > 0 ||
    input.sendsLastHour >= t.sendsOver
  )
    return "over";
  if (
    (input.metaPct ?? 0) >= t.metaPctWarn ||
    input.throttledLast24h > 0 ||
    input.sendsLastHour >= t.sendsWarn
  )
    return "warn";
  return "ok";
}

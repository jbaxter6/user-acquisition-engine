import { describe, expect, it } from "vitest";
import {
  highestPct,
  isInvalidTokenResponse,
  isThrottleResponse,
  parseUsageHeaders,
  usageLevel,
  usageThresholds,
} from "./usage.js";

describe("parseUsageHeaders", () => {
  it("returns null when Meta sends no usage header", () => {
    expect(parseUsageHeaders(new Headers())).toBeNull();
  });

  it("reads the flat X-App-Usage shape", () => {
    const h = new Headers({ "x-app-usage": '{"call_count":12,"total_cputime":3,"total_time":7}' });
    expect(parseUsageHeaders(h)).toEqual({
      callCountPct: 12,
      totalTimePct: 7,
      totalCputimePct: 3,
      regainAccessMinutes: null,
    });
  });

  it("reads X-Business-Use-Case-Usage and keeps the worst entry", () => {
    const h = new Headers({
      "x-business-use-case-usage": JSON.stringify({
        "123": [
          { type: "instagram", call_count: 20, total_cputime: 5, total_time: 9, estimated_time_to_regain_access: 0 },
          { type: "messenger", call_count: 64, total_cputime: 1, total_time: 2, estimated_time_to_regain_access: 15 },
        ],
      }),
    });
    expect(parseUsageHeaders(h)).toEqual({
      callCountPct: 64,
      totalTimePct: 9,
      totalCputimePct: 5,
      regainAccessMinutes: 15,
    });
  });

  it("takes the max across both headers when both are present", () => {
    const h = new Headers({
      "x-app-usage": '{"call_count":90,"total_cputime":0,"total_time":0}',
      "x-business-use-case-usage": '{"1":[{"call_count":10,"total_cputime":40,"total_time":1}]}',
    });
    expect(highestPct(parseUsageHeaders(h))).toBe(90);
  });

  it("ignores a malformed header instead of throwing", () => {
    expect(parseUsageHeaders(new Headers({ "x-app-usage": "not json" }))).toBeNull();
  });
});

describe("isThrottleResponse", () => {
  it("treats 429 as throttled", () => {
    expect(isThrottleResponse(429, "")).toBe(true);
  });

  it("recognises Meta's rate-limit error codes", () => {
    expect(isThrottleResponse(400, '{"error":{"code":4}}')).toBe(true);
    expect(isThrottleResponse(400, '{"error":{"code":80002}}')).toBe(true);
  });

  it("does not flag other errors", () => {
    expect(isThrottleResponse(400, '{"error":{"code":190}}')).toBe(false);
    expect(isThrottleResponse(500, "oops")).toBe(false);
  });
});

describe("isInvalidTokenResponse", () => {
  it("recognises Meta's invalidated-session error (code 190)", () => {
    const body = JSON.stringify({
      error: {
        message: "Error validating access token: The session has been invalidated because the user changed their password",
        type: "OAuthException",
        code: 190,
      },
    });
    expect(isInvalidTokenResponse(body)).toBe(true);
  });

  it("ignores other errors and non-JSON bodies", () => {
    expect(isInvalidTokenResponse('{"error":{"code":4}}')).toBe(false);
    expect(isInvalidTokenResponse("Bad Gateway")).toBe(false);
  });
});

describe("usageLevel", () => {
  const t = usageThresholds({});
  const quiet = { metaPct: null, throttledLastHour: 0, throttledLast24h: 0, sendsLastHour: 0 };

  it("defaults the send thresholds to 30 / 60", () => {
    expect(t).toMatchObject({ sendsWarn: 30, sendsOver: 60 });
  });

  it("honours env overrides and ignores junk values", () => {
    expect(usageThresholds({ META_SENDS_WARN: "10", META_SENDS_MAX: "abc" })).toMatchObject({
      sendsWarn: 10,
      sendsOver: 60,
    });
  });

  it("is ok when nothing is happening", () => {
    expect(usageLevel(quiet, t)).toBe("ok");
  });

  it("warns at 50% of Meta's quota and goes over at 80%", () => {
    expect(usageLevel({ ...quiet, metaPct: 49 }, t)).toBe("ok");
    expect(usageLevel({ ...quiet, metaPct: 50 }, t)).toBe("warn");
    expect(usageLevel({ ...quiet, metaPct: 80 }, t)).toBe("over");
  });

  it("warns on a throttle in the last day, over in the last hour", () => {
    expect(usageLevel({ ...quiet, throttledLast24h: 1 }, t)).toBe("warn");
    expect(usageLevel({ ...quiet, throttledLastHour: 1, throttledLast24h: 1 }, t)).toBe("over");
  });

  it("uses send pace", () => {
    expect(usageLevel({ ...quiet, sendsLastHour: 30 }, t)).toBe("warn");
    expect(usageLevel({ ...quiet, sendsLastHour: 60 }, t)).toBe("over");
  });
});

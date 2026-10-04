import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const base = {
  CRM_URL: "http://localhost:5173",
  PLATFORM: "instagram",
  TEMPLATE_NAME: "Intro",
};

describe("parseConfig", () => {
  it("fills in the batch and the gap", () => {
    const config = parseConfig(base);
    expect(config).toMatchObject({
      crmUrl: "http://localhost:5173",
      platform: "instagram",
      templateName: "Intro",
      batchSize: 10,
      minDelayMs: 45_000,
      maxDelayMs: 90_000,
      dryRun: false,
    });
    expect(config.blockedHandles).toEqual(
      expect.arrayContaining(["movewithsmooth", "smoothmediatechnologies"]),
    );
  });

  it("keeps the Smooth accounts blocked when more handles are added", () => {
    const config = parseConfig({ ...base, BLOCKED_HANDLES: "@Other.Account" });
    expect(config.blockedHandles).toContain("movewithsmooth");
    expect(config.blockedHandles).toContain("other.account");
  });

  it("rejects a batch over 20 and a gap under 15 seconds", () => {
    expect(() => parseConfig({ ...base, BATCH_SIZE: "21" })).toThrow(/BATCH_SIZE/);
    expect(() => parseConfig({ ...base, MIN_DELAY_MS: "1000" })).toThrow(/15000/);
  });

  it("rejects an unknown platform", () => {
    expect(() => parseConfig({ ...base, PLATFORM: "twitch" })).toThrow(/PLATFORM/);
  });
});

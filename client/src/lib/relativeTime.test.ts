import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, parseServerDate } from "./relativeTime";

describe("parseServerDate", () => {
  it("reads SQLite's timezone-less timestamps as UTC", () => {
    expect(parseServerDate("2026-09-20 09:00:00").toISOString()).toBe("2026-09-20T09:00:00.000Z");
  });

  it("leaves ISO timestamps alone", () => {
    expect(parseServerDate("2026-09-20T09:00:00+02:00").toISOString()).toBe("2026-09-20T07:00:00.000Z");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["2026-09-26 11:59:58", "just now"],
    ["2026-09-26 11:59:30", "30s ago"],
    ["2026-09-26 11:55:00", "5m ago"],
    ["2026-09-26 09:00:00", "3h ago"],
    ["2026-09-24 12:00:00", "2d ago"],
    ["2026-09-12 12:00:00", "2w ago"],
    ["2026-06-26 12:00:00", "3mo ago"],
    ["2024-09-26 12:00:00", "2y ago"],
  ])("%s → %s", (timestamp, text) => {
    expect(formatRelativeTime(timestamp)).toBe(text);
  });
});

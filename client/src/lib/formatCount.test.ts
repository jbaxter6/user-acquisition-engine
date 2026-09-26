import { describe, expect, it } from "vitest";
import { formatCount, parseCount } from "./formatCount";

describe("formatCount", () => {
  it.each([
    [950, "950"],
    [12_500, "12.5k"],
    [1_000_000, "1M"],
    [250_000, "250k"],
    [2_500_000_000, "2.5B"],
  ])("%d → %s", (n, text) => {
    expect(formatCount(n)).toBe(text);
  });
});

describe("parseCount", () => {
  it.each([
    ["10k", 10_000],
    ["1.2M", 1_200_000],
    ["10,000", 10_000],
    ["2.5 b", 2_500_000_000],
    [" 42 ", 42],
  ])("%s → %d", (text, n) => {
    expect(parseCount(text)).toBe(n);
  });

  it.each(["", "-5", "lots", "10x"])("rejects %j", (text) => {
    expect(parseCount(text)).toBeNull();
  });

  it("round-trips what formatCount prints", () => {
    for (const n of [950, 12_500, 1_000_000, 250_000]) expect(parseCount(formatCount(n))).toBe(n);
  });
});

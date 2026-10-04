import { describe, expect, it } from "vitest";
import { normalizeTags, TagError } from "./templateTags.js";

describe("normalizeTags", () => {
  it("trims, splits commas, and keeps the first spelling of a repeat", () => {
    expect(normalizeTags([" Opener ", "opener", "Follow up, soft"])).toEqual([
      "Opener",
      "Follow up",
      "soft",
    ]);
  });

  it("treats a missing list as no tags", () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });

  it("rejects a non-list, a long tag, and more than eight", () => {
    expect(() => normalizeTags("opener")).toThrow(TagError);
    expect(() => normalizeTags(["x".repeat(33)])).toThrow(/32/);
    expect(() => normalizeTags(["a", "b", "c", "d", "e", "f", "g", "h", "i"])).toThrow(/8/);
  });
});

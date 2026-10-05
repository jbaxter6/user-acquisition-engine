import { describe, expect, it } from "vitest";
import { AuthorError, normalizeAuthors } from "./templateAuthors.js";

describe("normalizeAuthors", () => {
  it("keeps John and Justin, in that order, ignoring case and repeats", () => {
    expect(normalizeAuthors([" Justin ", "JOHN", "john"])).toEqual(["john", "justin"]);
  });

  it("treats a missing list as no authors", () => {
    expect(normalizeAuthors(undefined)).toEqual([]);
    expect(normalizeAuthors(null)).toEqual([]);
    expect(normalizeAuthors(["", "  "])).toEqual([]);
  });

  it("rejects a non-list and a name that isn't John or Justin", () => {
    expect(() => normalizeAuthors("john")).toThrow(AuthorError);
    expect(() => normalizeAuthors(["alex"])).toThrow(/"john" or "justin"/);
  });
});

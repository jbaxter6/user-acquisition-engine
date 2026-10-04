import { describe, expect, it } from "vitest";
import { hasTag, tagsInUse } from "./templateTags";

describe("template tags", () => {
  it("lists each tag once, in alphabetical order", () => {
    expect(
      tagsInUse([
        { tags: ["Follow up", "opener"] },
        { tags: ["Opener"] },
        {},
      ]),
    ).toEqual(["Follow up", "opener"]);
  });

  it("matches a tag without caring about case", () => {
    expect(hasTag(["Opener"], "opener")).toBe(true);
    expect(hasTag(["Opener"], "soft")).toBe(false);
    expect(hasTag(undefined, "opener")).toBe(false);
  });
});

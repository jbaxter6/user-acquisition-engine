import { describe, expect, it } from "vitest";
import { assertHandleAllowed, blockReason, StopRun } from "./guard.js";

describe("blockReason", () => {
  it("stops on a login wall, a challenge, or a rate-limit heading", () => {
    expect(blockReason("https://www.instagram.com/accounts/login/", "")).toMatch(/login wall/);
    expect(blockReason("https://www.instagram.com/challenge/", "")).toMatch(/challenge/);
    expect(blockReason("https://www.instagram.com/direct/t/1", "Try Again Later")).toMatch(/try again later/);
    expect(blockReason("https://www.instagram.com/direct/t/1", "hey, loved the set")).toBeNull();
  });
});

describe("assertHandleAllowed", () => {
  it("refuses a Smooth account and allows a throwaway", () => {
    expect(() => assertHandleAllowed("MoveWithSmooth", ["movewithsmooth"])).toThrow(StopRun);
    expect(() => assertHandleAllowed("@throwaway", ["movewithsmooth"])).not.toThrow();
  });
});

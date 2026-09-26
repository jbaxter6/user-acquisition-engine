import { describe, expect, it } from "vitest";
import type { AttributeDef } from "../types";
import {
  attributesFor,
  convertNumericValue,
  criterionProblem,
  defaultCriterion,
  describeCriterion,
  type DraftCriterion,
} from "./profileCriteria";

const def = (over: Partial<AttributeDef>): AttributeDef => ({
  key: "followers",
  label: "Followers",
  group: "audience",
  platforms: ["instagram", "tiktok"],
  type: "count",
  unit: "followers",
  description: "",
  filterable: true,
  hasData: ["instagram"],
  ...over,
});

const followers = def({});
const engagement = def({ key: "engagement_rate", label: "Engagement rate", type: "percent", unit: "%" });
const country = def({
  key: "country",
  label: "Country",
  type: "enum",
  options: [{ value: "US", label: "United States" }, { value: "CA", label: "Canada" }],
});
const verified = def({ key: "verified", label: "Verified", type: "boolean" });

const draft = (over: Partial<DraftCriterion>): DraftCriterion =>
  ({ id: "c1", attribute: "followers", mode: "required", operator: "gte", value: null, ...over }) as DraftCriterion;

describe("defaultCriterion", () => {
  it("starts each attribute type with a sensible operator", () => {
    expect(defaultCriterion(followers, "required")).toMatchObject({ operator: "gte", value: null });
    expect(defaultCriterion(country, "required")).toMatchObject({ operator: "in", value: [] });
    expect(defaultCriterion(verified, "required")).toMatchObject({ operator: "is", value: true });
  });

  it("gives nice-to-haves a medium weight", () => {
    expect(defaultCriterion(followers, "preferred").weight).toBe(2);
    expect(defaultCriterion(followers, "required").weight).toBeUndefined();
  });

  it("refuses display-only attributes", () => {
    expect(() => defaultCriterion(def({ key: "bio", type: "text" }), "required")).toThrow();
  });
});

describe("convertNumericValue", () => {
  it("keeps the number when switching to a range", () => {
    expect(convertNumericValue(10_000, "between")).toEqual([10_000, null]);
  });

  it("keeps the low end when switching back from a range", () => {
    expect(convertNumericValue([10_000, 50_000], "gte")).toBe(10_000);
    expect(convertNumericValue([null, 50_000], "lte")).toBe(50_000);
  });
});

describe("criterionProblem", () => {
  it("accepts a complete criterion", () => {
    expect(criterionProblem(draft({ operator: "between", value: [10_000, 100_000] }), followers)).toBeNull();
  });

  it.each([
    ["an empty range", draft({ operator: "between", value: [10_000, null] }), followers, "Enter both a min and a max"],
    ["an upside-down range", draft({ operator: "between", value: [5, 1] }), followers, "Min can't be more than max"],
    ["a percentage over 100", draft({ operator: "gte", value: 150 }), engagement, "Can't exceed 100"],
    ["a missing value", draft({ operator: "gte", value: null }), followers, "Enter a value"],
    ["no options picked", draft({ operator: "in", value: [] }), country, "Pick at least one option"],
    ["no keywords", draft({ operator: "contains_any", value: [] }), followers, "Add at least one keyword"],
  ])("flags %s", (_label, criterion, attribute, problem) => {
    expect(criterionProblem(criterion, attribute)).toBe(problem);
  });
});

describe("describeCriterion", () => {
  it.each([
    [draft({ operator: "between", value: [10_000, 100_000] }), followers, "10k–100k followers"],
    [draft({ operator: "gte", value: 3 }), engagement, "≥ 3% engagement rate"],
    [draft({ operator: "in", value: ["US", "CA"] }), country, "Country: United States, Canada"],
    [draft({ operator: "not_in", value: ["US"] }), country, "Country: not United States"],
    [draft({ operator: "is", value: false }), verified, "Not verified"],
    [draft({ operator: "lte", value: null }), followers, "≤ ? followers"],
  ])("%# → %s", (criterion, attribute, text) => {
    expect(describeCriterion(criterion, attribute)).toBe(text);
  });
});

describe("attributesFor", () => {
  it("keeps only the platform's attributes", () => {
    const twitchOnly = def({ key: "avg_viewers", platforms: ["twitch"] });
    expect(attributesFor([followers, twitchOnly], "twitch")).toEqual([twitchOnly]);
  });
});

import { describe, expect, it } from "vitest";
import {
  getAttribute,
  incompatibleCriteria,
  normalizeAttributeValue,
  validateCriteria,
  type Criterion,
} from "./attributes.js";

const base = { id: "c1", mode: "required" } as const;

function errorsOf(input: unknown, platform: Parameters<typeof validateCriteria>[1] = "instagram") {
  const r = validateCriteria(input, platform);
  return r.ok ? [] : r.errors;
}

describe("validateCriteria", () => {
  it("accepts an empty list", () => {
    expect(validateCriteria([], "instagram")).toEqual({ ok: true, criteria: [] });
  });

  it("rejects non-arrays", () => {
    expect(errorsOf({})).toEqual(["criteria must be an array"]);
  });

  it("accepts a follower range and keeps it", () => {
    const r = validateCriteria(
      [{ ...base, attribute: "followers", operator: "between", value: [10000, 100000] }],
      "instagram",
    );
    expect(r).toEqual({
      ok: true,
      criteria: [{ ...base, attribute: "followers", operator: "between", value: [10000, 100000] }],
    });
  });

  it("allows a zero-width range but not an inverted one", () => {
    expect(errorsOf([{ ...base, attribute: "followers", operator: "between", value: [5, 5] }])).toEqual([]);
    expect(errorsOf([{ ...base, attribute: "followers", operator: "between", value: [10, 5] }])[0]).toMatch(
      /min can't exceed max/,
    );
  });

  it("rejects negative and non-numeric values", () => {
    expect(errorsOf([{ ...base, attribute: "followers", operator: "gte", value: -1 }])).toHaveLength(1);
    expect(errorsOf([{ ...base, attribute: "followers", operator: "gte", value: "10k" }])).toHaveLength(1);
    expect(errorsOf([{ ...base, attribute: "followers", operator: "gte", value: NaN }])).toHaveLength(1);
  });

  it("caps percentages at 100", () => {
    expect(errorsOf([{ ...base, attribute: "engagement_rate", operator: "gte", value: 100 }])).toEqual([]);
    expect(errorsOf([{ ...base, attribute: "engagement_rate", operator: "gte", value: 101 }])[0]).toMatch(/100/);
    expect(
      errorsOf([{ ...base, attribute: "engagement_rate", operator: "between", value: [1, 150] }])[0],
    ).toMatch(/100/);
  });

  it("rejects attributes not on the profile's platform", () => {
    expect(
      errorsOf([{ ...base, attribute: "avg_concurrent_viewers", operator: "gte", value: 50 }], "instagram")[0],
    ).toMatch(/isn't available on instagram/);
    expect(
      errorsOf([{ ...base, attribute: "avg_concurrent_viewers", operator: "gte", value: 50 }], "twitch"),
    ).toEqual([]);
  });

  it("rejects unknown attributes and operators wrong for the type", () => {
    expect(errorsOf([{ ...base, attribute: "nope", operator: "gte", value: 1 }])[0]).toMatch(/unknown attribute/);
    expect(errorsOf([{ ...base, attribute: "followers", operator: "in", value: ["x"] }])[0]).toMatch(
      /operator "in"/,
    );
  });

  it("validates enum options and dedupes", () => {
    const r = validateCriteria(
      [{ ...base, attribute: "account_type", operator: "in", value: ["creator", "creator", "business"] }],
      "instagram",
    );
    expect(r.ok && r.criteria[0].value).toEqual(["creator", "business"]);
    expect(
      errorsOf([{ ...base, attribute: "account_type", operator: "in", value: ["influencer"] }])[0],
    ).toMatch(/invalid option/);
    expect(errorsOf([{ ...base, attribute: "account_type", operator: "in", value: [] }])[0]).toMatch(
      /at least one/,
    );
  });

  it("normalizes keywords (trim, lowercase, dedupe, drop blanks)", () => {
    const r = validateCriteria(
      [{ ...base, attribute: "bio_keywords", operator: "contains_any", value: [" Gym ", "gym", "", "FITNESS"] }],
      "instagram",
    );
    expect(r.ok && r.criteria[0].value).toEqual(["gym", "fitness"]);
    expect(
      errorsOf([{ ...base, attribute: "bio_keywords", operator: "contains_any", value: ["  "] }])[0],
    ).toMatch(/at least one keyword/);
  });

  it("requires booleans for 'is'", () => {
    expect(errorsOf([{ ...base, attribute: "verified", operator: "is", value: true }])).toEqual([]);
    expect(errorsOf([{ ...base, attribute: "verified", operator: "is", value: "true" }])).toHaveLength(1);
  });

  it("defaults preferred weight to 2 and strips weight from required", () => {
    const r = validateCriteria(
      [
        { id: "a", mode: "preferred", attribute: "verified", operator: "is", value: true },
        { id: "b", mode: "required", weight: 3, attribute: "has_email", operator: "is", value: true },
      ],
      "instagram",
    );
    expect(r.ok && r.criteria.map((c) => c.weight)).toEqual([2, undefined]);
    expect(r.ok && "weight" in r.criteria[1]).toBe(false);
  });

  it("rejects bad weights, modes, missing and duplicate ids", () => {
    const v = { attribute: "verified", operator: "is", value: true };
    expect(errorsOf([{ ...v, id: "a", mode: "preferred", weight: 5 }])[0]).toMatch(/weight/);
    expect(errorsOf([{ ...v, id: "a", mode: "sometimes" }])[0]).toMatch(/mode/);
    expect(errorsOf([{ ...v, mode: "required" }])[0]).toMatch(/id is required/);
    expect(
      errorsOf([
        { ...v, id: "a", mode: "required" },
        { ...v, id: "a", mode: "required" },
      ])[0],
    ).toMatch(/duplicate id/);
  });

  it("reports every bad criterion, not just the first", () => {
    expect(
      errorsOf([
        { ...base, id: "a", attribute: "nope", operator: "gte", value: 1 },
        { ...base, id: "b", attribute: "followers", operator: "gte", value: -1 },
      ]),
    ).toHaveLength(2);
  });
});

describe("incompatibleCriteria", () => {
  it("finds criteria whose attribute isn't on the target platform", () => {
    const criteria: Criterion[] = [
      { ...base, id: "a", attribute: "followers", operator: "gte", value: 1 },
      { ...base, id: "b", attribute: "account_type", operator: "in", value: ["creator"] },
      { ...base, id: "c", attribute: "country", operator: "in", value: ["US"] },
    ];
    expect(incompatibleCriteria(criteria, "twitch").map((c) => c.id)).toEqual(["b"]);
    expect(incompatibleCriteria(criteria, "youtube").map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("display-only attributes", () => {
  it("can't be used as criteria", () => {
    expect(errorsOf([{ ...base, attribute: "links", operator: "contains_any", value: ["x"] }])[0]).toMatch(
      /can't be used as a criterion/,
    );
  });
});

describe("normalizeAttributeValue", () => {
  const def = (k: string) => getAttribute(k)!;

  it("accepts non-negative counts and rejects junk", () => {
    expect(normalizeAttributeValue(def("following"), 752)).toBe(752);
    expect(normalizeAttributeValue(def("following"), 0)).toBe(0);
    expect(normalizeAttributeValue(def("following"), -1)).toBeUndefined();
    expect(normalizeAttributeValue(def("following"), "752")).toBeUndefined();
  });

  it("requires real booleans", () => {
    expect(normalizeAttributeValue(def("verified"), true)).toBe(true);
    expect(normalizeAttributeValue(def("verified"), "Yes")).toBeUndefined();
  });

  it("lowercases keywords but keeps list items as written", () => {
    expect(normalizeAttributeValue(def("primary_category"), "Digital creator")).toEqual(["digital creator"]);
    expect(normalizeAttributeValue(def("links"), ["linktr.ee/Caitlin", " ", "linktr.ee/Caitlin"])).toEqual([
      "linktr.ee/Caitlin",
    ]);
    expect(normalizeAttributeValue(def("mentions"), [])).toBeUndefined();
  });

  it("trims text and drops empty text", () => {
    expect(normalizeAttributeValue(def("pronouns"), " she/her ")).toBe("she/her");
    expect(normalizeAttributeValue(def("pronouns"), "  ")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { Criterion } from "./attributes.js";
import { evaluate, summarize } from "./match.js";

const must = (c: Omit<Criterion, "id" | "mode">, id = "r"): Criterion => ({ id, mode: "required", ...c });
const nice = (c: Omit<Criterion, "id" | "mode">, weight: 1 | 2 | 3, id: string): Criterion => ({
  id,
  mode: "preferred",
  weight,
  ...c,
});

const outcome = (c: Criterion, attrs: Record<string, unknown>) => evaluate([c], attrs).results[0].outcome;

describe("evaluate: operators", () => {
  it("between is inclusive at both edges", () => {
    const c = must({ attribute: "followers", operator: "between", value: [10_000, 100_000] });
    expect(outcome(c, { followers: 10_000 })).toBe("pass");
    expect(outcome(c, { followers: 100_000 })).toBe("pass");
    expect(outcome(c, { followers: 9_999 })).toBe("fail");
    expect(outcome(c, { followers: 100_001 })).toBe("fail");
  });

  it("gte / lte", () => {
    expect(outcome(must({ attribute: "engagement_rate", operator: "gte", value: 3 }), { engagement_rate: 3 })).toBe("pass");
    expect(outcome(must({ attribute: "engagement_rate", operator: "gte", value: 3 }), { engagement_rate: 2.9 })).toBe("fail");
    expect(outcome(must({ attribute: "post_count", operator: "lte", value: 50 }), { post_count: 50 })).toBe("pass");
    expect(outcome(must({ attribute: "post_count", operator: "lte", value: 50 }), { post_count: 51 })).toBe("fail");
  });

  it("in / not_in", () => {
    const inUS = must({ attribute: "country", operator: "in", value: ["US", "CA"] });
    const notUS = must({ attribute: "country", operator: "not_in", value: ["US"] });
    expect(outcome(inUS, { country: "CA" })).toBe("pass");
    expect(outcome(inUS, { country: "GB" })).toBe("fail");
    expect(outcome(notUS, { country: "GB" })).toBe("pass");
    expect(outcome(notUS, { country: "US" })).toBe("fail");
  });

  it("contains_any / contains_none match inside stored items, case-insensitively", () => {
    const any = must({ attribute: "bio_keywords", operator: "contains_any", value: ["fitness"] });
    const none = must({ attribute: "bio_keywords", operator: "contains_none", value: ["crypto"] });
    expect(outcome(any, { bio_keywords: ["Fitness coach", "mom"] })).toBe("pass");
    expect(outcome(any, { bio_keywords: ["gaming"] })).toBe("fail");
    expect(outcome(none, { bio_keywords: ["gaming"] })).toBe("pass");
    expect(outcome(none, { bio_keywords: ["crypto bro"] })).toBe("fail");
  });

  it("is", () => {
    const c = must({ attribute: "verified", operator: "is", value: true });
    expect(outcome(c, { verified: true })).toBe("pass");
    expect(outcome(c, { verified: false })).toBe("fail");
  });

  it("missing or wrong-shaped values are unknown, not failures", () => {
    const c = must({ attribute: "followers", operator: "gte", value: 1 });
    expect(outcome(c, {})).toBe("unknown");
    expect(outcome(c, { followers: null })).toBe("unknown");
    expect(outcome(c, { followers: "lots" })).toBe("unknown");
    expect(outcome(must({ attribute: "bio_keywords", operator: "contains_any", value: ["x"] }), { bio_keywords: [] })).toBe(
      "unknown",
    );
  });
});

describe("evaluate: match / possible / score", () => {
  const criteria = [
    must({ attribute: "followers", operator: "gte", value: 10_000 }, "f"),
    must({ attribute: "country", operator: "in", value: ["US"] }, "c"),
    nice({ attribute: "verified", operator: "is", value: true }, 3, "v"),
    nice({ attribute: "engagement_rate", operator: "gte", value: 3 }, 1, "e"),
  ];

  it("matches when every must-have passes", () => {
    expect(evaluate(criteria, { followers: 20_000, country: "US" })).toMatchObject({ matched: true, possible: false });
  });

  it("is only possible when a must-have is unknown", () => {
    expect(evaluate(criteria, { followers: 20_000 })).toMatchObject({ matched: false, possible: true });
  });

  it("is neither when any must-have fails, even if others are unknown", () => {
    expect(evaluate(criteria, { followers: 5 })).toMatchObject({ matched: false, possible: false });
  });

  it("scores nice-to-haves by weight, over only the ones we had data for", () => {
    expect(evaluate(criteria, { verified: true, engagement_rate: 1 }).score).toBe(75);
    expect(evaluate(criteria, { verified: true }).score).toBe(100);
    expect(evaluate(criteria, {}).score).toBeNull();
  });

  it("nice-to-haves never affect match status", () => {
    expect(evaluate(criteria, { followers: 20_000, country: "US", verified: false })).toMatchObject({ matched: true });
  });

  it("a profile with no must-haves matches everyone", () => {
    expect(evaluate([], {})).toMatchObject({ matched: true, possible: false });
  });
});

describe("summarize", () => {
  it("counts matches, possibles and per-criterion outcomes", () => {
    const criteria = [must({ attribute: "followers", operator: "gte", value: 10_000 }, "f")];
    const summary = summarize(criteria, [
      { attributes: { followers: 20_000 } },
      { attributes: { followers: 5 } },
      { attributes: {} },
    ]);
    expect(summary).toEqual({
      match: 1,
      possible: 1,
      total: 3,
      criteria: { f: { pass: 1, fail: 1, unknown: 1 } },
    });
  });
});

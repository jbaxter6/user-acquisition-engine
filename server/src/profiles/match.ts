import { getAttribute, type Criterion } from "./attributes.js";

// Matching a prospect against a profile's criteria. Pure — no DB, no I/O —
// see docs/profiles-architecture.md §4 for the semantics.
//
// Unknown is a first-class outcome, not a fail: most prospects only have a
// few attributes, and counting missing data as a failure would make every
// multi-criterion profile match nothing.

export type Outcome = "pass" | "fail" | "unknown";

export interface Evaluation {
  // All required criteria pass.
  matched: boolean;
  // No required criterion fails, but at least one couldn't be checked.
  possible: boolean;
  // 0–100 from the preferred criteria we had data for; null if none.
  score: number | null;
  results: { criterionId: string; outcome: Outcome }[];
}

function outcomeFor(c: Criterion, actual: unknown): Outcome {
  if (actual === undefined || actual === null) return "unknown";
  const def = getAttribute(c.attribute);
  if (!def) return "unknown";

  switch (c.operator) {
    case "between": {
      if (typeof actual !== "number") return "unknown";
      const [lo, hi] = c.value as [number, number];
      return actual >= lo && actual <= hi ? "pass" : "fail";
    }
    case "gte":
      if (typeof actual !== "number") return "unknown";
      return actual >= (c.value as number) ? "pass" : "fail";
    case "lte":
      if (typeof actual !== "number") return "unknown";
      return actual <= (c.value as number) ? "pass" : "fail";
    case "in":
    case "not_in": {
      if (typeof actual !== "string") return "unknown";
      const hit = (c.value as string[]).includes(actual);
      return hit === (c.operator === "in") ? "pass" : "fail";
    }
    case "contains_any":
    case "contains_none": {
      // Stored keyword lists are lowercased on write; a criterion keyword
      // matches if it appears inside any stored item ("fitness" hits
      // "fitness coach").
      const items = (Array.isArray(actual) ? actual : [actual])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.toLowerCase());
      if (items.length === 0) return "unknown";
      const hit = (c.value as string[]).some((k) => items.some((item) => item.includes(k)));
      return hit === (c.operator === "contains_any") ? "pass" : "fail";
    }
    case "is":
      if (typeof actual !== "boolean") return "unknown";
      return actual === c.value ? "pass" : "fail";
  }
}

export function evaluate(criteria: Criterion[], attributes: Record<string, unknown>): Evaluation {
  const results = criteria.map((c) => ({
    criterionId: c.id,
    outcome: outcomeFor(c, attributes[c.attribute]),
  }));

  let failed = false;
  let unknown = false;
  let earned = 0;
  let possibleWeight = 0;
  criteria.forEach((c, i) => {
    const { outcome } = results[i];
    if (c.mode === "required") {
      if (outcome === "fail") failed = true;
      if (outcome === "unknown") unknown = true;
    } else if (outcome !== "unknown") {
      const w = c.weight ?? 2;
      possibleWeight += w;
      if (outcome === "pass") earned += w;
    }
  });

  return {
    matched: !failed && !unknown,
    possible: !failed && unknown,
    score: possibleWeight ? Math.round((earned / possibleWeight) * 100) : null,
    results,
  };
}

export interface MatchSummary {
  match: number;
  possible: number;
  total: number;
  // Per-criterion outcome counts across the same prospects.
  criteria: Record<string, Record<Outcome, number>>;
}

export function summarize(
  criteria: Criterion[],
  prospects: { attributes: Record<string, unknown> }[],
): MatchSummary {
  const summary: MatchSummary = {
    match: 0,
    possible: 0,
    total: prospects.length,
    criteria: Object.fromEntries(criteria.map((c) => [c.id, { pass: 0, fail: 0, unknown: 0 }])),
  };
  for (const p of prospects) {
    const e = evaluate(criteria, p.attributes);
    if (e.matched) summary.match++;
    else if (e.possible) summary.possible++;
    for (const r of e.results) summary.criteria[r.criterionId][r.outcome]++;
  }
  return summary;
}

import type {
  AttributeDef,
  Criterion,
  CriterionOperator,
  Platform,
} from "../types";
import { formatCount } from "./formatCount";

// A criterion while it's being edited: numeric fields can be blank until
// the user fills them in. Converted to a real Criterion on save.
export type DraftValue =
  | number
  | null
  | [number | null, number | null]
  | string[]
  | boolean;

export interface DraftCriterion extends Omit<Criterion, "value"> {
  value: DraftValue;
}

export const OPERATOR_LABEL: Record<CriterionOperator, string> = {
  between: "between",
  gte: "at least",
  lte: "at most",
  in: "is any of",
  not_in: "is none of",
  contains_any: "includes any of",
  contains_none: "includes none of",
  is: "is",
};

export const GROUP_LABEL = {
  audience: "Audience",
  content: "Content",
  identity: "Identity",
} as const;

export const WEIGHT_LABEL = { 1: "Low", 2: "Medium", 3: "High" } as const;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultCriterion(
  def: AttributeDef,
  mode: Criterion["mode"],
): DraftCriterion {
  const base = { id: newId(), attribute: def.key, mode, ...(mode === "preferred" ? { weight: 2 as const } : {}) };
  switch (def.type) {
    case "count":
    case "percent":
    case "number":
      return { ...base, operator: "gte", value: null };
    case "enum":
      return { ...base, operator: "in", value: [] };
    case "keywords":
      return { ...base, operator: "contains_any", value: [] };
    case "boolean":
      return { ...base, operator: "is", value: true };
    case "text":
    case "list":
      // Display-only attributes are filtered out of the editor's picker.
      throw new Error(`${def.key} can't be used as a criterion`);
  }
}

// Carries the value across when switching between numeric operators, so
// "at least 10k" -> "between" becomes "10k – ___" instead of blanking.
export function convertNumericValue(
  value: DraftValue,
  to: CriterionOperator,
): DraftValue {
  const single = Array.isArray(value) ? (value[0] as number | null) ?? (value[1] as number | null) : (value as number | null);
  if (to === "between") return Array.isArray(value) ? value : [single, null];
  return single;
}

// Why this criterion can't be saved yet, or null if it's complete. Mirrors
// the server's validateCriteria so the user sees problems inline.
export function criterionProblem(c: DraftCriterion, def: AttributeDef): string | null {
  const max = def.type === "percent" ? 100 : Infinity;
  switch (c.operator) {
    case "between": {
      const [lo, hi] = c.value as [number | null, number | null];
      if (lo == null || hi == null) return "Enter both a min and a max";
      if (lo > hi) return "Min can't be more than max";
      if (hi > max) return `Can't exceed ${max}`;
      return null;
    }
    case "gte":
    case "lte": {
      const v = c.value as number | null;
      if (v == null) return "Enter a value";
      if (v > max) return `Can't exceed ${max}`;
      return null;
    }
    case "in":
    case "not_in":
      return (c.value as string[]).length ? null : "Pick at least one option";
    case "contains_any":
    case "contains_none":
      return (c.value as string[]).length ? null : "Add at least one keyword";
    case "is":
      return null;
  }
}

export function toCriterion(c: DraftCriterion): Criterion {
  return c as Criterion;
}

function fmt(n: number, def: AttributeDef): string {
  if (def.type === "percent") return `${n}%`;
  if (def.type === "count") return formatCount(n);
  return String(n);
}

// One-line human summary, e.g. "10k–100k followers", "Country: US, CA".
export function describeCriterion(c: Criterion | DraftCriterion, def: AttributeDef): string {
  const noun = def.type === "count" && def.unit ? def.unit : def.label.toLowerCase();
  const optionLabel = (v: string) => def.options?.find((o) => o.value === v)?.label ?? v;
  switch (c.operator) {
    case "between": {
      const [lo, hi] = c.value as [number | null, number | null];
      return `${lo == null ? "?" : fmt(lo, def)}–${hi == null ? "?" : fmt(hi, def)} ${noun}`;
    }
    case "gte":
      return `≥ ${c.value == null ? "?" : fmt(c.value as number, def)} ${noun}`;
    case "lte":
      return `≤ ${c.value == null ? "?" : fmt(c.value as number, def)} ${noun}`;
    case "in":
      return `${def.label}: ${(c.value as string[]).map(optionLabel).join(", ") || "?"}`;
    case "not_in":
      return `${def.label}: not ${(c.value as string[]).map(optionLabel).join(", ") || "?"}`;
    case "contains_any":
      return `${def.label}: ${(c.value as string[]).join(", ") || "?"}`;
    case "contains_none":
      return `${def.label}: none of ${(c.value as string[]).join(", ") || "?"}`;
    case "is":
      return c.value ? def.label : `Not ${def.label.toLowerCase()}`;
  }
}

export function attributesFor(all: AttributeDef[], platform: Platform): AttributeDef[] {
  return all.filter((a) => a.platforms.includes(platform));
}

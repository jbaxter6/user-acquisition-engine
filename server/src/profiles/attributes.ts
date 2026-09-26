import type { Platform } from "../adapters/types.js";

// The attribute registry: the single catalog of everything a target profile
// can filter on, per platform. The Profiles UI renders its form from this
// (served at GET /api/profiles/attributes), and later the prospect importer
// and the matcher key off the same `key`s — see docs/profiles-architecture.md.
// Adding a platform attribute should be a one-entry change here, not a UI
// change.

export type AttributeType =
  | "count"
  | "percent"
  | "number"
  | "enum"
  | "keywords"
  | "boolean"
  // Display-only types: stored and shown on prospect cards, never offered
  // as Profile criteria.
  | "text"
  | "list";

export type Operator =
  | "between"
  | "gte"
  | "lte"
  | "in"
  | "not_in"
  | "contains_any"
  | "contains_none"
  | "is";

export type AttributeGroup = "audience" | "content" | "identity";

export interface AttributeDef {
  key: string;
  label: string;
  group: AttributeGroup;
  platforms: Platform[];
  type: AttributeType;
  unit?: string;
  options?: { value: string; label: string }[];
  description: string;
  // False for display-only attributes (pronouns, links…) — the Profiles
  // editor won't offer them and validateCriteria rejects them.
  filterable: boolean;
  // Platforms where some prospect data source (scraper → import) fills this
  // today. Criteria on attributes without data are allowed (they start
  // counting once a source comes online) — the UI just flags them.
  hasData: Platform[];
}

export const OPERATORS_BY_TYPE: Record<AttributeType, Operator[]> = {
  count: ["between", "gte", "lte"],
  percent: ["between", "gte", "lte"],
  number: ["between", "gte", "lte"],
  enum: ["in", "not_in"],
  keywords: ["contains_any", "contains_none"],
  boolean: ["is"],
  text: [],
  list: [],
};

const ALL: Platform[] = ["instagram", "tiktok", "twitch", "youtube"];

const COUNTRIES = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["IE", "Ireland"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["BR", "Brazil"],
  ["MX", "Mexico"],
  ["AR", "Argentina"],
  ["CO", "Colombia"],
  ["IN", "India"],
  ["PH", "Philippines"],
  ["ID", "Indonesia"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["ZA", "South Africa"],
  ["NG", "Nigeria"],
  ["AE", "United Arab Emirates"],
].map(([value, label]) => ({ value, label }));

const LANGUAGES = [
  ["en", "English"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["pl", "Polish"],
  ["sv", "Swedish"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
  ["tl", "Tagalog"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["ar", "Arabic"],
].map(([value, label]) => ({ value, label }));

export const ATTRIBUTES: AttributeDef[] = [
  // ---- Audience ----
  {
    key: "followers",
    label: "Followers",
    group: "audience",
    platforms: ["instagram", "tiktok", "twitch"],
    type: "count",
    unit: "followers",
    description: "Total follower count.",
    filterable: true,
    hasData: ["instagram", "tiktok", "twitch"],
  },
  {
    key: "following",
    label: "Following",
    group: "audience",
    platforms: ["instagram", "tiktok"],
    type: "count",
    unit: "following",
    description: "How many accounts they follow.",
    filterable: true,
    hasData: ["instagram", "tiktok"],
  },
  {
    key: "likes_total",
    label: "Total likes",
    group: "audience",
    platforms: ["tiktok"],
    type: "count",
    unit: "likes",
    description: "Lifetime likes across all videos, as shown on the profile (rounded, e.g. 2.7B).",
    filterable: true,
    hasData: ["tiktok"],
  },
  {
    key: "subscribers",
    label: "Subscribers",
    group: "audience",
    platforms: ["youtube"],
    type: "count",
    unit: "subscribers",
    description: "Channel subscriber count.",
    filterable: true,
    hasData: [],
  },
  {
    key: "engagement_rate",
    label: "Engagement rate",
    group: "audience",
    platforms: ["instagram", "tiktok", "youtube"],
    type: "percent",
    unit: "%",
    description: "Average (likes + comments) per post, as a % of followers.",
    filterable: true,
    hasData: [],
  },
  {
    key: "avg_views",
    label: "Avg. views",
    group: "audience",
    platforms: ["instagram", "tiktok", "youtube"],
    type: "count",
    unit: "views",
    description: "Average views per post (Reels on Instagram).",
    filterable: true,
    hasData: [],
  },
  {
    key: "avg_concurrent_viewers",
    label: "Avg. concurrent viewers",
    group: "audience",
    platforms: ["twitch"],
    type: "count",
    unit: "viewers",
    description: "Average concurrent viewers across recent streams.",
    filterable: true,
    hasData: [],
  },
  // ---- Content ----
  {
    key: "post_count",
    label: "Total posts",
    group: "content",
    platforms: ["instagram", "tiktok", "youtube"],
    type: "count",
    unit: "posts",
    description: "Lifetime number of posts / videos.",
    filterable: true,
    hasData: ["instagram"],
  },
  {
    key: "posts_per_week",
    label: "Posts per week",
    group: "content",
    platforms: ["instagram", "tiktok", "youtube"],
    type: "number",
    unit: "/ week",
    description: "Recent posting cadence.",
    filterable: true,
    hasData: [],
  },
  {
    key: "hours_streamed_per_week",
    label: "Hours streamed per week",
    group: "content",
    platforms: ["twitch"],
    type: "number",
    unit: "hrs / week",
    description: "Recent average weekly stream time.",
    filterable: true,
    hasData: [],
  },
  {
    key: "primary_category",
    label: "Category / niche",
    group: "content",
    platforms: ALL,
    type: "keywords",
    description:
      "Content niche (e.g. fitness, beauty) — or primary game on Twitch.",
    filterable: true,
    hasData: ["instagram"],
  },
  {
    key: "bio_keywords",
    label: "Bio keywords",
    group: "content",
    platforms: ALL,
    type: "keywords",
    description: "Words appearing in the account's bio / channel description.",
    filterable: true,
    hasData: [],
  },
  // ---- Identity ----
  {
    key: "account_type",
    label: "Account type",
    group: "identity",
    platforms: ["instagram"],
    type: "enum",
    options: [
      { value: "creator", label: "Creator" },
      { value: "business", label: "Business" },
      { value: "personal", label: "Personal" },
    ],
    description: "Instagram account type.",
    filterable: true,
    hasData: [],
  },
  {
    key: "broadcaster_type",
    label: "Broadcaster type",
    group: "identity",
    platforms: ["twitch"],
    type: "enum",
    options: [
      { value: "partner", label: "Partner" },
      { value: "affiliate", label: "Affiliate" },
      { value: "none", label: "Neither" },
    ],
    description: "Twitch Partner / Affiliate status.",
    filterable: true,
    hasData: [],
  },
  {
    key: "verified",
    label: "Verified",
    group: "identity",
    platforms: ["instagram", "tiktok", "youtube"],
    type: "boolean",
    description: "Has the platform's verified badge.",
    filterable: true,
    hasData: ["instagram", "tiktok"],
  },
  {
    key: "country",
    label: "Country",
    group: "identity",
    platforms: ALL,
    type: "enum",
    options: COUNTRIES,
    description: "Where the creator is based.",
    filterable: true,
    hasData: [],
  },
  {
    key: "language",
    label: "Language",
    group: "identity",
    platforms: ALL,
    type: "enum",
    options: LANGUAGES,
    description: "Primary language of their content.",
    filterable: true,
    hasData: [],
  },
  {
    key: "has_email",
    label: "Has contact email",
    group: "identity",
    platforms: ALL,
    type: "boolean",
    description: "We have an email address on file for them.",
    filterable: true,
    hasData: ALL,
  },
  {
    key: "is_private",
    label: "Private account",
    group: "identity",
    platforms: ["instagram", "tiktok"],
    type: "boolean",
    description: "Their posts are hidden from non-followers.",
    filterable: true,
    hasData: ["instagram", "tiktok"],
  },
  // ---- Display-only (shown on prospect cards, not filterable) ----
  {
    key: "pronouns",
    label: "Pronouns",
    group: "identity",
    platforms: ["instagram"],
    type: "text",
    description: "As listed on their profile. For personalizing messages, not for targeting.",
    filterable: false,
    hasData: ["instagram"],
  },
  {
    key: "links",
    label: "Links",
    group: "identity",
    platforms: ALL,
    type: "list",
    description: "Link(s) in bio.",
    filterable: false,
    hasData: ["instagram", "tiktok"],
  },
  {
    key: "mentions",
    label: "Mentioned accounts",
    group: "identity",
    platforms: ALL,
    type: "list",
    description: "@handles named in their bio — often a second account or collaborator.",
    filterable: false,
    hasData: ["instagram", "tiktok"],
  },
  {
    key: "highlights",
    label: "Highlights",
    group: "content",
    platforms: ["instagram"],
    type: "list",
    description: "Story highlight titles.",
    filterable: false,
    hasData: ["instagram"],
  },
];

const BY_KEY = new Map(ATTRIBUTES.map((a) => [a.key, a]));

export function getAttribute(key: string): AttributeDef | undefined {
  return BY_KEY.get(key);
}

export function attributesForPlatform(platform: Platform): AttributeDef[] {
  return ATTRIBUTES.filter((a) => a.platforms.includes(platform));
}

// ---- Criteria ----

export type CriterionValue = number | boolean | [number, number] | string[];

export interface Criterion {
  id: string;
  attribute: string;
  operator: Operator;
  value: CriterionValue;
  mode: "required" | "preferred";
  // Only meaningful for "preferred": 1 low / 2 medium / 3 high.
  weight?: 1 | 2 | 3;
}

export const MAX_CRITERIA = 50;
const MAX_LIST_ITEMS = 50;

type Result =
  | { ok: true; criteria: Criterion[] }
  | { ok: false; errors: string[] };

function isNonNegNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

// Validates untrusted input against the registry and returns a normalized
// copy (trimmed/lowercased keywords, deduped lists, default weights). The
// server never stores criteria that didn't pass through here.
export function validateCriteria(input: unknown, platform: Platform): Result {
  if (!Array.isArray(input)) return { ok: false, errors: ["criteria must be an array"] };
  if (input.length > MAX_CRITERIA)
    return { ok: false, errors: [`at most ${MAX_CRITERIA} criteria allowed`] };

  const errors: string[] = [];
  const out: Criterion[] = [];
  const seenIds = new Set<string>();

  input.forEach((raw, i) => {
    const at = `criteria[${i}]`;
    if (typeof raw !== "object" || raw === null) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const c = raw as Record<string, unknown>;

    if (typeof c.id !== "string" || !c.id.trim() || c.id.length > 64) {
      errors.push(`${at}: id is required`);
      return;
    }
    if (seenIds.has(c.id)) {
      errors.push(`${at}: duplicate id "${c.id}"`);
      return;
    }
    seenIds.add(c.id);

    const def = typeof c.attribute === "string" ? getAttribute(c.attribute) : undefined;
    if (!def) {
      errors.push(`${at}: unknown attribute "${String(c.attribute)}"`);
      return;
    }
    if (!def.filterable) {
      errors.push(`${at}: "${def.label}" can't be used as a criterion`);
      return;
    }
    if (!def.platforms.includes(platform)) {
      errors.push(`${at}: "${def.label}" isn't available on ${platform}`);
      return;
    }

    const operator = c.operator as Operator;
    if (!OPERATORS_BY_TYPE[def.type].includes(operator)) {
      errors.push(`${at}: operator "${String(c.operator)}" isn't valid for ${def.label}`);
      return;
    }

    if (c.mode !== "required" && c.mode !== "preferred") {
      errors.push(`${at}: mode must be "required" or "preferred"`);
      return;
    }

    const value = normalizeValue(def, operator, c.value);
    if (typeof value === "string") {
      errors.push(`${at}: ${def.label} ${value}`);
      return;
    }

    let weight: 1 | 2 | 3 | undefined;
    if (c.mode === "preferred") {
      weight = c.weight === undefined ? 2 : (c.weight as 1 | 2 | 3);
      if (weight !== 1 && weight !== 2 && weight !== 3) {
        errors.push(`${at}: weight must be 1, 2 or 3`);
        return;
      }
    }

    out.push({
      id: c.id,
      attribute: def.key,
      operator,
      value,
      mode: c.mode,
      ...(weight !== undefined ? { weight } : {}),
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true, criteria: out };
}

// Returns the normalized value, or an error message string.
function normalizeValue(
  def: AttributeDef,
  operator: Operator,
  value: unknown,
): CriterionValue | string {
  const max = def.type === "percent" ? 100 : Infinity;

  switch (operator) {
    case "between": {
      if (!Array.isArray(value) || value.length !== 2)
        return "range must be [min, max]";
      const [lo, hi] = value;
      if (!isNonNegNumber(lo) || !isNonNegNumber(hi))
        return "range values must be non-negative numbers";
      if (lo > hi) return "range min can't exceed max";
      if (hi > max) return `can't exceed ${max}`;
      return [lo, hi];
    }
    case "gte":
    case "lte": {
      if (!isNonNegNumber(value)) return "value must be a non-negative number";
      if (value > max) return `can't exceed ${max}`;
      return value;
    }
    case "in":
    case "not_in": {
      if (!Array.isArray(value) || value.length === 0)
        return "needs at least one option";
      const allowed = new Set(def.options?.map((o) => o.value));
      const picked = Array.from(new Set(value));
      const bad = picked.find((v) => typeof v !== "string" || !allowed.has(v));
      if (bad !== undefined) return `has an invalid option "${String(bad)}"`;
      return picked as string[];
    }
    case "contains_any":
    case "contains_none": {
      if (!Array.isArray(value)) return "needs a list of keywords";
      const words = Array.from(
        new Set(
          value
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean),
        ),
      );
      if (words.length === 0) return "needs at least one keyword";
      if (words.length > MAX_LIST_ITEMS)
        return `allows at most ${MAX_LIST_ITEMS} keywords`;
      return words;
    }
    case "is": {
      if (typeof value !== "boolean") return "value must be true or false";
      return value;
    }
  }
}

// Criteria whose attribute doesn't exist on `platform` — used to refuse a
// platform change rather than silently dropping them.
export function incompatibleCriteria(
  criteria: Criterion[],
  platform: Platform,
): Criterion[] {
  return criteria.filter((c) => !getAttribute(c.attribute)?.platforms.includes(platform));
}

// ---- Prospect attribute values ----

const MAX_TEXT = 500;
const MAX_LIST_ITEM = 200;

// Validates one observed value (from an import or the scraper) for storage
// in prospect_attributes. Returns the normalized value, or undefined if it
// doesn't fit the attribute — callers skip those rather than failing the
// whole row.
export function normalizeAttributeValue(
  def: AttributeDef,
  value: unknown,
): number | boolean | string | string[] | undefined {
  switch (def.type) {
    case "count":
    case "number":
    case "percent": {
      if (!isNonNegNumber(value)) return undefined;
      if (def.type === "percent" && value > 100) return undefined;
      return value;
    }
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "enum": {
      if (typeof value !== "string") return undefined;
      return def.options?.some((o) => o.value === value) ? value : undefined;
    }
    case "text": {
      if (typeof value !== "string" || !value.trim()) return undefined;
      return value.trim().slice(0, MAX_TEXT);
    }
    case "keywords":
    case "list": {
      const items = (Array.isArray(value) ? value : [value])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().slice(0, MAX_LIST_ITEM))
        .map((v) => (def.type === "keywords" ? v.toLowerCase() : v))
        .filter(Boolean);
      const unique = Array.from(new Set(items)).slice(0, MAX_LIST_ITEMS);
      return unique.length ? unique : undefined;
    }
  }
}

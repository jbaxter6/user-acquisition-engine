# Profiles — Architecture Plan

Status: **Phase 1 built** (2026-09-25). Phases 2–4 not started.
Owner: JB · Drafted 2026-09-25

Phase 1 went ahead with the recommended defaults for the open questions in
§9: UI name "Profiles", the starting attribute set, must-have/nice-to-have
with weights, and one platform per profile. Revisit them there.

Built as designed, with two small additions: `POST /api/profiles/:id/restore`
(archived profiles can be un-archived) and a `hasData` flag on each registry
entry that drives the "No data yet" marker.

---

## 1. What this is

A **Profile** is a saved description of *who we want to reach* on a specific
platform — e.g. "Mid-tier IG fitness creator: 10k–100k followers, >3%
engagement, creator account, US/CA". It is a set of **criteria** over
platform-specific **attributes**.

Profiles are not prospects. Prospects are real accounts; Profiles are the
templates we compare them against. The long-term payoff is three consumers
of the same criteria:

| Consumer | What it does with a Profile | Phase |
|---|---|---|
| **Profiles page** | Create / edit / archive personas | 1 |
| **Matchmaking** | Score existing prospects against a profile ("42 prospects match") | 3 |
| **Discovery** | Translate criteria into a provider search (Modash etc.) to *find* new prospects | 4 |

Designing for all three now (even though we only build the first) is the
point of this document — it's what keeps Profiles from being a form that
saves JSON nobody can use.

---

## 2. The core idea: an attribute registry

The one piece everything hinges on is a single **attribute registry**: a
server-side catalog of every attribute a Profile can filter on, per platform.

```ts
// server/src/profiles/attributes.ts
interface AttributeDef {
  key: string;                 // "followers", "engagement_rate", "avg_concurrent_viewers"
  label: string;               // "Followers"
  platforms: Platform[];       // which platforms this attribute exists on
  type: "count" | "percent" | "number" | "enum" | "keywords" | "boolean";
  unit?: string;               // "followers", "%", "hrs/week"
  options?: { value: string; label: string }[];  // for enum
  operators: Operator[];       // which comparisons make sense for this type
  description?: string;        // tooltip: how it's measured / where it comes from
}
```

Why a registry instead of free-form fields:

1. **One contract, three consumers.** The Profiles UI renders its form from
   it, the prospect importer maps spreadsheet columns onto it, and the matcher
   evaluates against it. If "engagement_rate" means one thing everywhere, the
   matchmaking in Phase 3 is just plumbing.
2. **Platform-specific without per-platform code.** Twitch's "avg concurrent
   viewers" and YouTube's "subscribers" are just registry entries. Adding a
   platform attribute is a one-line change, not a UI change.
3. **The client stays dumb.** The client fetches the registry from
   `GET /api/profiles/attributes` rather than duplicating it. There is no
   shared client/server package today, and adding one means changing both
   build configs — not worth it for this.

### Starting attribute set (to confirm — see §9)

| Key | Type | IG | TikTok | Twitch | YouTube | Notes |
|---|---|:-:|:-:|:-:|:-:|---|
| `followers` | count | ✓ | ✓ | ✓ | — | Already on `prospects` |
| `subscribers` | count | | | | ✓ | |
| `engagement_rate` | percent | ✓ | ✓ | | ✓ | (likes+comments)/followers per post |
| `avg_views` | count | ✓ (reels) | ✓ | | ✓ | |
| `post_count` | count | ✓ | ✓ | | ✓ | media_count / video_count |
| `posts_per_week` | number | ✓ | ✓ | | ✓ | posting cadence |
| `account_type` | enum | ✓ | | | | business / creator / personal |
| `verified` | boolean | ✓ | ✓ | | ✓ | |
| `avg_concurrent_viewers` | count | | | ✓ | | |
| `hours_streamed_per_week` | number | | | ✓ | | |
| `broadcaster_type` | enum | | | ✓ | | partner / affiliate / none |
| `primary_category` | enum/keywords | ✓ | ✓ | ✓ | ✓ | niche; game for Twitch |
| `bio_keywords` | keywords | ✓ | ✓ | ✓ | ✓ | matches bio/description text |
| `country` | enum | ✓ | ✓ | ✓ | ✓ | |
| `language` | enum | ✓ | ✓ | ✓ | ✓ | |
| `has_email` | boolean | ✓ | ✓ | ✓ | ✓ | derivable from `prospects.email` |

Most of these we **can't populate yet**. That's expected and handled
explicitly (see "unknown" in §4). A Profile can hold criteria we don't have
data for yet; they start matching as data sources come online.

---

## 3. Data model

### 3.1 `target_profiles`

Named `target_profiles` in code, **"Profiles" in the UI**. The codebase
already uses "profile" to mean a social account's profile
(`instagramProfile.ts`, `fetchParticipantProfile`, `profile_picture_url`),
so a bare `profiles` table would be ambiguous within a month.

```sql
CREATE TABLE IF NOT EXISTS target_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  platform TEXT NOT NULL,          -- one platform per profile (see decision below)
  criteria_json TEXT NOT NULL DEFAULT '[]',
  color TEXT,                      -- optional swatch for badges on prospect cards
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
```

Added via the existing idempotent migration list in `server/src/db.ts`.
Archive, not delete — same as `message_templates` — so matches and
(eventually) Discovery runs that reference a profile keep their history.

### 3.2 Criteria shape

```ts
type Operator = "between" | "gte" | "lte" | "eq" | "in" | "not_in"
              | "contains_any" | "contains_none" | "is";

interface Criterion {
  id: string;            // client-generated uuid; stable React key + future per-criterion stats
  attribute: string;     // registry key
  operator: Operator;
  value: number | string | boolean | [number, number] | string[];
  mode: "required" | "preferred";
  weight?: 1 | 2 | 3;    // only for "preferred": low / medium / high
}
```

- **required** = hard filter. Fails → prospect doesn't match.
- **preferred** = soft signal. Contributes to a 0–100 match score.

This split matters because hard-filter-only is too blunt ("9,900 followers"
shouldn't vanish from a 10k+ profile if everything else is perfect), and
score-only is too fuzzy ("must be US-based" really is a must).

**Decision: JSON column, not a `profile_criteria` table.** Criteria are
heterogeneous (ranges, lists, booleans), always read and written as a unit
with their profile, and evaluated in TypeScript, not SQL. A child table buys
nothing but joins. The server validates `criteria_json` against the registry
on every write — unknown attribute, wrong operator for the type, or an
attribute not available on the profile's platform → `400`.

**Decision: one platform per profile.** Attributes are platform-specific, and
prospects are already one row per platform (with `prospect_links` tying the
same person's cards together). A cross-platform persona ("streamer with a
Twitch *and* a TikTok presence") can come later as a *group* of platform
profiles evaluated across linked prospects. Not building that now, but the
per-platform model doesn't block it.

### 3.3 `prospect_attributes` (Phase 2)

Matching needs somewhere to put prospect data beyond `followers`:

```sql
CREATE TABLE IF NOT EXISTS prospect_attributes (
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  attribute TEXT NOT NULL,        -- registry key
  value_json TEXT NOT NULL,
  source TEXT NOT NULL,           -- 'excel_upload' | 'business_discovery' | 'manual' | 'modash' ...
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (prospect_id, attribute)
);
```

Keyed by the same registry keys, so every data source (spreadsheet import,
Business Discovery, a future scraping provider, a manual edit) writes to one
place and the matcher reads one place. `source` + `observed_at` let us show
"engagement 4.2% · via Modash · 3 days ago" and prefer fresher data later.

The existing `prospects.followers` column stays (lots of code reads it). The
matcher reads `followers` from the column when no attribute row exists.
Backfill and consolidate only if it gets in the way.

---

## 4. Matching semantics (Phase 3, designed now)

A pure function, with no DB or I/O, so it's trivially testable:

```ts
// server/src/profiles/match.ts
evaluate(profile, attributes): {
  matched: boolean;            // all required criteria pass (unknowns don't fail — see below)
  score: number;               // 0–100 from preferred criteria that could be evaluated
  coverage: number;            // fraction of criteria we actually had data for
  results: { criterionId; outcome: "pass" | "fail" | "unknown"; actual? }[];
}
```

**Unknown is a first-class outcome, not a fail.** Right now almost every
prospect has only follower count. If missing data counted as failure, every
profile with more than one criterion would match nothing, and people would
stop trusting the feature on day one. Instead:

- Required criterion, value unknown → doesn't disqualify, but the match is
  shown as **"Possible match"** rather than **"Match"**.
- Preferred criterion, value unknown → excluded from the score denominator.
- `coverage` is shown next to the score so a 100 score on 1 of 6 criteria
  doesn't look like a 100 score on 6 of 6.

Profile platform ≠ prospect platform → not evaluated at all.

**Compute on read, don't cache (yet).** Evaluation is a few comparisons per
criterion. Even at 10k prospects × 20 profiles, that's milliseconds.
Add a `profile_matches` cache table only if it's measurably slow. A cache now
would need invalidation on every profile edit and every attribute write.

---

## 5. API

Mirrors `routes/templates.ts`. Mounted at `/api/profiles` behind `siteAuth`.

**Phase 1**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/profiles/attributes?platform=` | Registry (the form schema) |
| GET | `/api/profiles?platform=&includeArchived=` | List |
| GET | `/api/profiles/:id` | One |
| POST | `/api/profiles` | Create (validated against registry) |
| PUT | `/api/profiles/:id` | Update (validated) |
| POST | `/api/profiles/:id/duplicate` | Copy as "Name (copy)" |
| DELETE | `/api/profiles/:id` | Archive |

Changing a profile's `platform` with criteria that don't exist on the new
platform → `409` listing the incompatible criteria. The UI confirms and
strips them, then resubmits. The server never silently drops criteria.

**Phase 3 additions**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/profiles/preview` | Unsaved criteria → `{ match, possible, total }` for live counts while editing |
| GET | `/api/profiles/:id/matches?limit=&offset=` | Ranked prospects with per-criterion results |
| GET | `/api/prospects?profileId=` | Filter the Prospecting list by profile |

---

## 6. UI

New route `/profiles`, nav order **Inbox · Prospecting · Profiles · Templates**
(Profiles feed Prospecting, so they sit next to it).

```
┌─ Profiles ─────────────────────┬─ Mid-tier IG Fitness ──────────────────────┐
│ [All] [IG] [TikTok] [Twitch]…  │ Name  [Mid-tier IG Fitness            ]    │
│                                │ Platform [Instagram ▾]  Color ●            │
│ ● Mid-tier IG Fitness   IG     │ Description [ ...                     ]    │
│   4 criteria                   │                                            │
│ ● Twitch Variety 50+ CCV TW    │ MUST HAVE                                  │
│   3 criteria                   │  Followers      between [10k] – [100k]  ✕  │
│ ● TikTok Beauty Micro   TT     │  Account type   is any of [Creator]     ✕  │
│                                │ NICE TO HAVE                               │
│ [+ New profile]                │  Engagement     ≥ [3] %      ●●○ med    ✕  │
│                                │  Bio keywords   any [gym][fitness]  ●○○ ✕  │
│                                │ [+ Add criterion ▾]                        │
│                                │                                            │
│                                │ (Phase 3) 42 match · 118 possible · of 900 │
│                                │ [Duplicate] [Archive]          [Save]      │
└────────────────────────────────┴────────────────────────────────────────────┘
```

- **"Add criterion"** lists only attributes for the selected platform, grouped
  (Audience / Content / Identity), each with a description tooltip.
- **Controls are chosen by attribute type** from the registry: `count` gets
  min/max inputs that accept `10k` / `1.2M`, `enum` gets chips, `keywords`
  gets a tag input, `boolean` gets a toggle. One `CriterionRow` component
  switches on type. There are no per-attribute components.
- **Must have / Nice to have** sections, instead of a "required" checkbox
  buried in each row. Weight is three dots (low/med/high), not a number.
- Criteria for attributes we have **no data source for yet** get a subtle
  "no data yet" marker, so it's clear why they won't affect matches today.
- Unsaved-changes guard when switching profiles.
- Mobile: list and editor stack. The editor opens as a full view with a back
  button, the same pattern as Inbox's thread view.

### Files

```
server/src/profiles/attributes.ts   registry + validateCriteria()
server/src/profiles/match.ts        evaluate()                     (Phase 3)
server/src/routes/profiles.ts       router
server/src/db.ts                    table + CRUD fns (matches existing convention)

client/src/components/ProfilesPage.tsx       list + editor layout
client/src/components/ProfileEditor.tsx      form, dirty state
client/src/components/CriterionRow.tsx       type-switched control
client/src/lib/formatCount.ts                "10k" <-> 10000 parse/format (reusable on prospect cards)
client/src/types/index.ts                    TargetProfile, Criterion, AttributeDef
client/src/api/client.ts                     profiles.* methods
```

---

## 7. Phases

| Phase | Scope | Done when |
|---|---|---|
| **1. Profiles** | Registry, `target_profiles`, CRUD API, Profiles page | Can create/edit/duplicate/archive platform profiles with validated criteria; survives reload/redeploy |
| **2. Prospect attributes** | `prospect_attributes` table; Excel import can map columns to any registry attribute (extends `prospectImport.ts` auto-mapping); show attributes on prospect cards; manual edit | Imported sheet with engagement/country columns lands as attributes |
| **3. Matchmaking** | `evaluate()`, preview counts in editor, matches list, profile filter + badges on Prospecting | "Show me prospects matching X", ranked, with per-criterion pass/fail/unknown |
| **4. Discovery** | Provider adapter translates Profile → provider query; results land as prospects with attributes | "Find more like this profile" button |

Phase 1 ships value on its own (a shared definition of who we target) and
every later phase builds on it without rework.

**Testing.** The repo has no test runner. `validateCriteria()` (Phase 1) and
`evaluate()` (Phase 3) are pure and are where the bugs would hide (range
edges, unknowns, platform mismatch), so I'd add `vitest` to `server/` for
those two modules only. UI verified in a real browser, not just typecheck.

---

## 8. Explicitly out of scope

- Cross-platform personas (see §3.2; possible later as profile groups)
- Auto-assigning prospects to profiles / auto-messaging on match
- Per-profile default message template (easy later: `default_template_id` column)
- Stored match history / analytics on which profiles convert best (easy later
  once matches exist: join matched prospects to `status`)

---

## 9. Open questions (need your call)

1. **Attribute list.** Is §2's starting set right? Anything missing that you
   actually filter on today (e.g. audience demographics, brand-deal history,
   "posts in English")?
2. **Must-have vs nice-to-have scoring.** Do you want the weighted score, or
   is pass/fail on hard filters enough to start? (Recommendation: build the
   `mode` field now, since it costs nothing, and hide weights in the UI if you
   don't want them.)
3. **One platform per profile.** OK for v1, or is cross-platform a day-one need?
4. **Naming.** "Profiles" in the UI, `target_profiles` in code. Or would you
   rather the UI say "Personas" to avoid confusion with a creator's own profile?
5. **Where attribute data comes from next.** Spreadsheet columns (Phase 2) is
   the cheap path. If you already know the Discovery provider, Phase 2's
   attribute keys should mirror its fields to avoid a translation layer later.

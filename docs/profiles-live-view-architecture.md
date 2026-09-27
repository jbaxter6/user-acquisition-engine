# Profiles — Locked Profiles, Live View & Match Count

Status: **Built 2026-09-26.** Decisions in §7.

Differences from the plan below:
- Archive is a plain secondary button next to "Use as template" (it turns
  red on hover), not an overflow menu.
- A template's draft is named "Name (copy)".
- The third stat tile's hint reads "N ruled out" (prospects failing a
  must-have), not a percentage. With today's data, a "could fit" percentage
  was mostly missing data and overstated the fit.
Drafted 2026-09-26. Builds on `docs/profiles-architecture.md` (Phase 1 built,
Phase 2 table exists, Phase 3 not started).

## 0. The ask

1. Once a profile is created it **can't be changed**, only archived.
2. A saved ("live") profile gets a **proper read-only view**, not the edit
   form with the inputs switched off.
3. That view shows **"X prospects match this profile."**

## 1. Where things stand today (and what conflicts)

- Profiles are **fully editable** right now. `PUT /api/profiles/:id` exists,
  and `ProfileEditor` shows "Save changes" for saved profiles. Rule (1) is a
  new rule, not a description of how things work today.
- A saved profile is shown in the **same form** as a new one. Only archived
  profiles are read-only, and those are just a disabled `<fieldset>`.
- **Duplicate** currently creates a saved server-side copy named
  "Name (copy)". Under rule (1) that copy would be locked at birth, so it would
  be useless as an edit path. Duplicate has to change (§2.2).
- **The matcher doesn't exist.** The `prospect_attributes` table is built,
  but `server/src/profiles/match.ts` / `evaluate()` (Phase 3) isn't.
- **There's almost no data to match on yet.** Live DB, 2026-09-26:

  | | IG | TikTok | Twitch | YouTube |
  |---|---|---|---|---|
  | prospects | 100 | 81 | 25 | 52 |
  | with `followers` | 3 | 0 | 0 | 0 |

  `prospect_attributes` has **0 rows**. With honest "unknown" handling
  (profiles-architecture §4), nearly every profile will show
  **0 match · N possible**. The number will be correct but not useful until
  the scraper or imports fill in attributes. This is worth knowing before we
  build, so the count doesn't look broken.

## 2. Locking profiles

### 2.1 Server

- **Remove `PUT /api/profiles/:id`.** Requests get the default 404, or an
  explicit `405 { error: "profiles are immutable; duplicate to change" }`.
  I prefer the explicit 405, because it documents the rule where someone
  would try to break it.
- The 409 platform-change logic in that handler goes with it. Platform is
  only picked at creation now.
- Delete `updateTargetProfile` from `db.ts` if nothing else uses it.
- Archive and restore stay as they are.

**Why lock at all (the reason to write down):** match counts, and later
Discovery runs and "matched via profile X" badges, refer to a profile by id.
If criteria could change under the same id, yesterday's "42 matches" would
silently mean something different today. Locking makes a profile id a stable
definition. `updated_at` becomes dead weight but can stay.

### 2.2 "Duplicate & edit" replaces editing

- Duplicate becomes **client-side only**. It opens the new-profile editor
  pre-filled with the source profile's platform, criteria, color and
  description, named "Name (v2)". Nothing is saved until "Create profile".
- Optionally, it offers to **archive the original** after the new one is
  created ("Replace original?" checkbox, on by default). That makes it feel
  like editing without breaking the lock.
- `POST /api/profiles/:id/duplicate` becomes unused and is removed.

### 2.3 Editor

`ProfileEditor` is only used for new (and duplicated) drafts. The
`profile` prop, `updateProfile`, "Save changes", dirty-tracking against a
saved profile, and the archived-fieldset path are all removed from it. It
gets simpler.

## 3. The live view

A new `ProfileView.tsx` (read-only) in the right panel when a saved profile
is selected. `ProfileEditor` shows only for "New" / "Duplicate".

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● Mid-tier IG Fitness                       [Duplicate & edit] [⋯]   │
│ [IG] Instagram · Created Sep 26, 2026                                │
│ Who this is and why we want them…                                    │
│                                                                      │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                │
│ │ 42            │ │ 118           │ │ 100           │                │
│ │ Match         │ │ Possible      │ │ IG prospects  │                │
│ └───────────────┘ └───────────────┘ └───────────────┘                │
│  "Possible" = passes everything we have data for, but some of the    │
│  must-haves are unknown.                                             │
│                                                                      │
│ MUST HAVE                                                            │
│  Followers        10k – 100k                          ✓ 45  ? 55     │
│  Account type     Creator                      no data yet           │
│                                                                      │
│ NICE TO HAVE                                                         │
│  Engagement       ≥ 3%                        ●●○     ? 100           │
│  Bio keywords     gym, fitness                ●○○     ? 100           │
└──────────────────────────────────────────────────────────────────────┘
```

- **Header:** color dot, name, platform icon + label, created date,
  description. The primary action is "Duplicate & edit". Archive sits in an
  overflow menu so it's hard to hit by accident.
- **Stat tiles:** Match / Possible / total prospects on that platform.
  Clicking Match or Possible later deep-links to
  `/prospecting?profileId=` (that's Phase 3's filter, not part of this
  change).
- **Criteria as sentences**, not form controls. They use the existing
  `formatCount` helper ("10k – 100k", "≥ 3%", "Creator, Business"). The
  "no data yet" marker comes from the registry's `hasData`.
- **Per-criterion coverage** (the right-hand ✓/? counts) is optional and
  cheap, because `evaluate()` already returns per-criterion outcomes. It's
  also the clearest way to show *why* the headline count is low, e.g. "? 100"
  on engagement. I recommend including it.
- **Archived** profiles use the same view with a banner and a "Restore"
  button instead of the Duplicate action. Match counts are hidden.
- The **list item** (left panel) gets a small "42 match" badge in place of
  "N criteria" when counts are loaded.

Styling reuses the existing tokens (`--panel`, `--border`, `--text-dim`,
12px radius) and the same padding as the new editor, so switching between
view and editor doesn't make the layout jump.

## 4. Match count

### 4.1 `server/src/profiles/match.ts`

The pure `evaluate(criteria, attrs)` from profiles-architecture §4, with no
changes to the agreed semantics:

- Per criterion: `pass | fail | unknown`.
- `matched` = no required criterion fails and none is unknown.
- `possible` = no required criterion fails, and at least one is unknown.
- Preferred criteria only affect score. They don't affect the match/possible
  counts.
- `followers` falls back to the `prospects.followers` column when no
  attribute row exists.

Tested with vitest (already set up in `server/`): range edges, every
operator × type, unknown handling, and the followers fallback.

### 4.2 API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/profiles/:id/summary` | `{ match, possible, total, criteria: { [criterionId]: { pass, fail, unknown } } }` |
| GET | `/api/profiles/summaries` | `{ [profileId]: { match, possible, total } }` for the list badges, one request |

**Computed on read, with no cache**, per the original doc. It loads the
platform's prospects plus their attributes in two queries
(`prospects WHERE platform = ?` and one `prospect_attributes` join), then
evaluates in memory. At 258 prospects this takes well under 1 ms. The
original doc says the same holds at 10k × 20.

Since profiles are now immutable, a cache would only need invalidating on
attribute writes. That makes caching easy later if it's ever needed.

### 4.3 What "match" counts

- Only prospects on the profile's platform.
- All statuses (new / contacted / replied / closed). Open question 3 asks
  whether that's right.

## 5. Files

```
server/src/profiles/match.ts          evaluate()                        new
server/src/profiles/match.test.ts     vitest                            new
server/src/db.ts                      listProspectsWithAttributes(platform); drop updateTargetProfile
server/src/routes/profiles.ts         -PUT, -duplicate, +summary, +summaries
server/src/routes/profiles.test.ts    replace PUT/duplicate tests with 405 + summary tests

client/src/components/ProfileView.tsx       read-only live view         new
client/src/components/ProfileEditor.tsx     new/duplicate drafts only
client/src/components/ProfilesPage.tsx      view vs editor routing, duplicate draft, list badges
client/src/lib/profileCriteria.ts           describeCriterion() → "10k – 100k"
client/src/api/client.ts                    -updateProfile, -duplicateProfile, +profileSummary(s)
client/src/types/index.ts                   ProfileSummary
client/src/index.css                        .profile-view*
docs/profiles-architecture.md               note the immutability decision; Phase 3 partially done
```

## 6. Build order

1. `match.ts` + tests. This part is pure and has no UI risk.
2. Summary endpoints.
3. Lock: remove PUT/duplicate endpoints and move Duplicate client-side.
4. `ProfileView` + list badges + CSS, checked in the browser at desktop and
   mobile widths.

## 7. Decisions (2026-09-26)

1. **Lock scope:** everything is locked: name, description, color, platform
   and criteria. The only thing you can edit is a *new* profile before it's
   created.
2. **Duplicate → "Use as template".** It opens a pre-filled new profile
   (`/profiles?id=new&from=<id>`). The original is **never** archived
   automatically, so the "Replace original?" option in §2.2 is dropped.
3. **Which prospects count:** every prospect on the profile's platform, with
   a **status filter on the KPI** (All / New / Contacted / Replied / Closed).
   The summary endpoint takes `?status=`. List badges always use All.
4. **Headline:** show both Match and Possible.
5. The existing live profile just becomes locked.

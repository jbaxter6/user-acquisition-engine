# Instagram Profile Data — What We Can Collect

Status: **Draft for review**. No code changes yet.
Feeds Phase 2 (prospect attributes) and Phase 3 (matching) of
[profiles-architecture.md](profiles-architecture.md).

## Ground rule

**We only collect what a person can see on screen, gathered through the
scraper's Chrome session with ordinary page loads, hovers and clicks.**
No direct calls to Instagram's internal endpoints (`web_profile_info`,
GraphQL), and no Graph API (Business Discovery) for enrichment. If a field
isn't visible in the UI, we treat it as unavailable.

Why: it keeps collection bounded to what's publicly displayed, and it keeps
the scraper's footprint looking like a person browsing, never like an API
client.

(The app's Graph API use for *messaging* connected accounts is a separate
concern and unaffected.)

---

## 1. Where we are today

The scraper ([war/scraper/src/sources/instagram.ts](../war/scraper/src/sources/instagram.ts))
loads each profile and keeps **5 things**: followers, display name, bio
(the header's flattened `innerText`), an email if one appears in the bio, and
the URL. It reads the followers from the `og:description` meta tag and the
rest from the header text in one blob, so bio, category, links and counts all
get mashed into one `notes` string.

It's already the right *approach* (a real page load in the logged-in browser).
It just reads the page shallowly. Everything below is about reading the same
page, plus a few clicks, properly.

> **One existing conflict with the ground rule.** The *discovery* step (the
> keyword search that finds handles) doesn't read the page. It listens to
> Instagram's own JSON responses in the background (`page.on("response")`)
> and pulls authors out of them. That isn't calling the API ourselves, but it
> does read API payloads rather than the UI. It needs a decision: switch it to
> reading post links from the rendered grid, or explicitly allow passive
> listening for discovery only. See §7 step 0.

`IG_APP_ID` in that file is unused and should be deleted, so nobody later
takes it as a hint to call the endpoint.

---

## 2. Field inventory

Worked example: the profile in the screenshot, `@musicreviewsbycaitlin`.

Selector notes are **expected anchors to confirm against a saved page**
(§7 step 1). Instagram's CSS class names are obfuscated and change, so every
read keys off stable things: `aria-label`s, `href` patterns, `<time datetime>`,
and visible text patterns. Class names are never used.

### A. Profile header — one page load, no clicks

| What | Example | How we read it (UI) | Use for matching |
|---|---|---|---|
| Username | musicreviewsbycaitlin | URL / header `h2` | identity |
| Verified | ✓ | badge `svg[aria-label="Verified"]` in header | filter |
| Display name | caitlin dyson \| melb/naarm | header name line | personalization; often a **location hint** |
| Pronouns | she/her | small text beside the name | personalization only (§5) |
| Posts / followers / following | 270 · 1,257 · 752 | header stat links (`a[href$="/followers/"]` etc.). Big accounts render rounded ("12.5K"), and the exact number sits in the stat's `title` tooltip, i.e. what you see on hover | core filters, follow ratio |
| Category label | Digital creator | grey line above the bio | niche. Its presence means a professional (creator/business) account; the UI doesn't reliably say which |
| Bio text | 🎸\| specialising in australian music… | bio block text | niche keywords, language |
| Bio @mentions | @caitlinsmusicspace | `<a>` links inside the bio | **linked accounts** → auto-populate `prospect_links` |
| Links | linktr.ee/… **and 1 more** | first link is visible; **click "and 1 more"** to open the links dialog and read all of them | link-in-bio → email & other socials (see C) |
| Highlights | shows !!, interviews !!, monthly picks | highlight circles' titles under the header | niche signal, effort signal |
| Private | — | "This account is private" text | **exclude** — stop here |
| Profile picture | (logo) | header `img` `src` | display in app |

### B. Recent posts — hovers and clicks on the same page

| What | How (UI) | Cost |
|---|---|---|
| Likes + comments per post | **hover each grid tile**; desktop shows a likes/comments overlay | cheap, no navigation |
| Pinned posts | pin icon on the tile | cheap. **Must be excluded** from recency/cadence math, since pinned posts can be years old |
| Reel view counts | **click the Reels tab**; each thumbnail shows its play count | 1 tab load |
| Post date | **open the post** (click tile → modal), read `<time datetime>` | 1 modal per post |
| Caption + hashtags | same modal | — |
| "Paid partnership" label | same modal, text under the username | — |
| Tagged / collab accounts | same modal (collab header, tags) | — |
| Likes hidden | modal shows "Liked by x and others" instead of a count | tells us engagement is *unknown*, not zero |

**Depth is a per-search setting**, so we control how many UI actions each
profile costs:

| Depth | Actions per profile | Gets |
|---|---|---|
| `light` | profile load | section A only |
| `standard` (default) | + hover 12 tiles + open newest 3 non-pinned posts | engagement, last-post date, brand-deal hint |
| `deep` | + Reels tab + open up to 12 posts | cadence, hashtags, views, collaborators |

Human-like delays (the existing 6–12s between profiles, plus 1–3s between
clicks within one) apply at every depth.

**Derived at ingest** from whatever depth ran:

| Derived attribute | From | Needs depth |
|---|---|---|
| `engagement_rate` | mean(likes + comments on hovered tiles) ÷ followers | standard |
| `avg_likes`, `avg_comments` | hover overlays | standard |
| `days_since_last_post` | newest non-pinned post's date | standard |
| `has_brand_deals` | "Paid partnership" or `#ad`/`#sponsored` in opened captions | standard (partial), deep |
| `avg_views` | Reels tab counts | deep |
| `posts_per_week` | dates across opened posts | deep |
| `top_hashtags`, `collaborators` | opened captions/modals | deep |
| `follower_following_ratio` | header | light |
| `country` / `city` | name + bio text ("melb/naarm" → Melbourne, AU), stored with `source: "inferred"` | light |
| `language` | language detection over bio (+ captions if opened) | light |
| `primary_category` | category label + bio/hashtag keywords | light |

### C. Off-Instagram — link-in-bio pages

Opening the Linktree (or similar) page in a tab is **the best value per click**
we have. Those pages list the creator's TikTok, YouTube, Spotify, and often an
email, which gives us cross-platform links and contacts in one visit. It's
also not an Instagram page load. (IMPROVEMENTS #6.)

### Not collecting

| What | Why not |
|---|---|
| Follower / following lists | scroll-heavy, the fastest way to get the account blocked, and not needed |
| Audience demographics | not shown in the UI to non-owners |
| Business email/phone "Contact" button | desktop web usually doesn't show it. Link-in-bio covers most emails anyway |
| Comment threads | many actions for little signal |

---

## 3. What caitlin's profile would produce (standard depth)

```
followers 1257 · following 752 · posts 270 · ratio 1.67
verified ✓ · professional (category "Digital creator")
bio_keywords [australian, music, reviews, interviews]
country AU (inferred from "melb/naarm") · language en
linked_accounts [@caitlinsmusicspace] · links [linktr.ee/…, <from "and 1 more">]
highlights [shows, interviews, monthly picks]
+ engagement_rate, avg_likes, avg_comments   (12 tile hovers)
+ days_since_last_post, has_brand_deals hint (3 opened posts)
```

That's enough to score her against a profile like *"AU music reviewers,
1k–20k, posted in the last 30 days, engagement ≥ 3%"*. Today we can only
check the follower count.

---

## 4. Storing it

Two changes to the Phase 2 plan in profiles-architecture.md:

1. **Keep what we extracted, per scrape.** Add a `prospect_snapshots` row per
   visit: `(prospect_id, platform, depth, extracted_json, scraped_at)`, where
   `extracted_json` is the structured UI read (header fields + per-post
   rows). Derived attributes are computed from it into `prospect_attributes`.
   When we invent a new derived attribute, we recompute from snapshots instead
   of revisiting profiles.
2. **Snapshot attributes at contact time.** This is what makes "which
   profiles respond to which messages" answerable. When a prospect is
   messaged, freeze their current attributes onto the send, e.g.
   `messages.prospect_attributes_json` next to the existing `template_id`.
   Otherwise analysis runs on today's numbers, not the numbers at pitch time.

Scraper output changes from a flat xlsx row to prospect + attributes + snapshot,
posted straight to the app's `/api/prospects/bulk` (IMPROVEMENTS #7). A
spreadsheet can't carry per-post rows.

---

## 5. Guardrails

- **Dedicated scraping account**, never one connected to the Meta app. Even
  UI-driven automation is against Instagram's terms. If the scraping login
  gets flagged, it shouldn't take the messaging app or its App Review with it.
- **Stop on friction.** Login wall, "Try again later", a challenge or a
  captcha: stop the run and save what we have (IMPROVEMENTS #3). No retry
  loops.
- **Pronouns: personalization, not targeting.** Stored and usable in a
  message, not offered as a Profile filter.
- **Private accounts:** record `private` and move on.
- **Selectors are the maintenance cost.** Keep all Instagram selectors in one
  module with page-snapshot tests (IMPROVEMENTS #8), so a UI change shows up
  as a failing test, not as silently empty columns.

---

## 6. Registry changes this implies

Additions to `server/src/profiles/attributes.ts`, Instagram unless noted:

| Key | Type | Notes |
|---|---|---|
| `following` | count | |
| `follower_following_ratio` | number | |
| `days_since_last_post` | number | all platforms; likely the most-used new filter |
| `avg_likes`, `avg_comments` | count | |
| `has_brand_deals` | boolean | |
| `is_private` | boolean | |
| `city` | keywords | alongside `country` |
| `hashtags` | keywords | separate from `bio_keywords` |

Adjust existing:
- `account_type` (creator/business/personal) → **`is_professional`** (boolean).
  The UI shows a category label for creator and business accounts alike, so
  we can't tell those two apart from the page.
- Flip to `hasData: true` as each ships: `engagement_rate`, `avg_views`,
  `post_count`, `posts_per_week`, `verified`, `bio_keywords`,
  `primary_category`, `country`, `language`.

---

## 7. Rollout order

0. **Decide on discovery** (§1): rewrite keyword discovery to read the
   rendered grid, or allow passive response listening for discovery only.
   Delete the unused `IG_APP_ID` either way.
1. **Save page fixtures.** With the scraper's Chrome, save the rendered HTML
   of one profile (caitlin's), its "and 1 more" links dialog, one opened post
   modal, and the Reels tab. Confirms every selector in §2 and becomes the
   test fixtures.
2. **Scraper: `readProfile` → structured UI extraction** at `light` depth
   (section A), selectors in one module, tested against the fixtures.
3. **Add `standard` depth** (hovers + 3 posts), then `deep`.
4. **App: Phase 2**: `prospect_snapshots` + `prospect_attributes`, bulk
   endpoint accepts them, attributes shown on prospect cards; registry
   changes (§6).
5. **Link-in-bio visit** for email + cross-platform links.
6. **Phase 3 matching**, then the **template × profile report**: reply rate
   per template, broken down by profile match and attribute bucket
   (e.g. "Pitch v2 gets 41% from 1k–5k accounts, 12% from 50k+").

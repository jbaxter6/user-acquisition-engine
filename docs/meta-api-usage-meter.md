# Meta API Usage Meter: Architecture Plan

Status: **Built** (2026-09-25). Signed off with the recommended answers
to §7: navbar chip, warn only (no blocking), 30/60 sends per hour.
Owner: JB · Drafted 2026-09-25

Built as designed, with small differences:
- The meter is a mini bar *inside* the chip, next to the account count,
  not underneath it.
- Sync now also returns `apiCalls`, and the Sync banner shows it.
- Meta's reading is ignored once it's over 24h old, since it only
  updates when we make a call.
- **Still to do from step 1:** check the server log for
  `Meta usage headers seen:` after the first real Meta call, and confirm
  which header `graph.instagram.com` sends. The parser accepts both.

---

## 1. What this is

A small always-visible meter that shows how hard we're using Meta's API,
**per connected Instagram account**. The goal is to see that we're getting
close to a limit before Meta throttles or flags one of our accounts.

It answers three questions at a glance:

1. How many Meta API calls has each account made in the last hour and the last 24 hours?
2. How close does **Meta itself** say we are to the limit?
3. Has Meta throttled us recently?

---

## 2. What we're actually up against

We use the **Instagram API with Instagram Login** (`graph.instagram.com`),
not the Marketing API. The limits that apply to us:

| Limit | Scope | Applies to |
|---|---|---|
| Business Use Case (BUC) quota: roughly `4800 × impressions` calls / 24h | per IG account | every call we make |
| Conversations API: about 2 calls / sec | per IG account | Sync (listing conversations and messages) |
| Send API: about 100 / sec (text), 10 / sec (media) | per IG account | sending DMs |
| Private replies to comments: 750 / hour | per IG account | not used today |

Two things change how much we should trust these numbers:

- **The BUC quota depends on each account's reach**, so there isn't one fixed
  number to count against. The only reliable reading is the usage Meta reports
  back on every response (`call_count`, `total_time`, `total_cputime` as
  percentages, plus `estimated_time_to_regain_access` when we're throttled).
  **The meter should show Meta's own percentage as the main number**, with our
  call counts as context.
- **"200 DMs/hour" is not a Meta rule.** It's a pacing habit some automation
  tools use. Our API can only reply inside Meta's 24h window anyway, so we
  can't cold-DM through it. We'll still count sends per hour, because that's
  the number that matters for looking spammy.

> **To verify during step 1:** the exact header name `graph.instagram.com`
> returns (`X-Business-Use-Case-Usage` vs `X-App-Usage`) and the throttle
> error codes (4 / 17 / 32 / 613 / 80002). We'll log real responses before
> building the parsing on top of them.

---

## 3. Where our calls come from today

There are about 10 raw `fetch` calls to Meta across 4 files, and none of them
are counted:

| Caller | Calls per run | Trigger |
|---|---|---|
| `sync.ts`: Sync button | `1 (/me) + ≤5 (conversation pages) + N conversations + M messages + avatar lookups` | manual |
| `adapters/instagram.ts`: send DM | 1 | each send |
| `instagramProfile.ts`: avatar backfill | 1 | per new conversation, sync + webhook |
| `routes/auth.ts`: connect account | 4 | once per connect |

**Sync is by far the biggest consumer.** It re-fetches *every* message's
details on every run. That was done on purpose (see the comment at
`sync.ts:128-137`), but it means one Sync on a busy account can cost
hundreds of calls. The meter will show the call count for each sync so we
can see this directly. Making Sync cheaper is a separate follow-up (§8).

---

## 4. Design

### 4.1 Server: one choke point for Meta calls

Add `server/src/meta/metaFetch.ts`:

```ts
metaFetch(accountId: number | null, kind: MetaCallKind, url: string | URL, init?: RequestInit): Promise<Response>
// kind: "sync.list" | "sync.thread" | "sync.message" | "profile" | "send" | "auth"
```

It calls `fetch`, then:
1. writes one row to `meta_api_calls`
2. parses Meta's usage header (if present) and stores the latest reading for that account
3. flags throttle responses (HTTP 429, or the throttle error codes above)

Then replace each raw `fetch` to `graph.instagram.com` / `api.instagram.com`
with `metaFetch`. Once that's done, **nothing new can call Meta without being
counted.**

### 4.2 Storage (SQLite, `db.ts`)

```sql
CREATE TABLE meta_api_calls (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER,            -- null for pre-connect auth calls
  kind       TEXT NOT NULL,
  status     INTEGER NOT NULL,
  throttled  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX meta_api_calls_account_time ON meta_api_calls(account_id, created_at);

-- latest reading of Meta's usage header, one row per account
CREATE TABLE meta_api_usage (
  account_id      INTEGER PRIMARY KEY,
  call_count_pct  REAL, total_time_pct REAL, total_cputime_pct REAL,
  regain_access_minutes INTEGER,
  updated_at      TEXT NOT NULL
);
```

Rows older than 30 days are deleted on startup.

### 4.3 API

`GET /api/meta/usage` returns, per account:

```ts
{
  accountId, username,
  calls: { lastHour, last24h, byKind: Record<MetaCallKind, number> },
  sendsLastHour,
  meta: { callCountPct, totalTimePct, totalCputimePct, regainAccessMinutes, updatedAt } | null,
  lastThrottledAt: string | null,
  lastSyncCalls: number | null,
  level: "ok" | "warn" | "over"
}
```

Reading the meter makes **no** Meta calls. It only reads our own table.

### 4.4 Status levels

`level` is the worse of:

| Signal | warn | over |
|---|---|---|
| Meta's highest reported % | ≥ 50% | ≥ 80% |
| Throttled | in the last 24h | in the last hour |
| Sends in the last hour | ≥ `META_SENDS_WARN` (default 30) | ≥ `META_SENDS_MAX` (default 60) |

The thresholds are env vars so they can be tuned without a deploy.

### 4.5 UI: inside the Instagram chip in the navbar (recommended)

- **The chip:** the status dot in the existing Instagram chip
  (`AccountConnection.tsx`) changes from connected-green to amber or red
  based on the worst account's `level`. The chip gets a thin meter bar
  underneath showing the highest Meta %.
- **The panel** (opens on click, already lists accounts): each account row
  gets a line like `42 calls/h · 610/24h · Meta 12% · last sync 188 calls`.
  Hovering the line shows the per-kind breakdown.
- **Refresh:** poll `/api/meta/usage` every 60s, and right after any sync or send.

Why the chip and not a floating widget in the bottom-left corner:
- The usage is **per account**, and the chip's panel already lists the accounts.
- A floating widget sits over the inbox and threads on every page.
- The dot already means "account health", so this just makes it meaningful.

If we want it louder later, an `over` state can also show a one-line banner
across the top of the page.

---

## 5. Out of scope

- **WAR (`war/`)**: the scraper drives the website in a browser, not the API.
  Its risk is behavioural (see `war/IMPORTANT.md`), not API quota.
- **TikTok**: there's no live connection yet. `metaFetch` is Meta-only, but
  the same pattern can extend to TikTok when it's connected.

---

## 6. Build steps

1. `metaFetch` + tables + switch every call site over. Log raw response headers to confirm the header name and format (§2).
2. `GET /api/meta/usage` + tests for the window counts and status levels.
3. Chip color + meter bar + panel lines.
4. WORKLOG + a short README note.

---

## 7. Open questions (need your call)

1. **Placement:** navbar chip (recommended) or a floating bottom-left meter?
2. **Warn only, or also block?** Should `over` just show red, or also **disable Sync and Send** for that account until Meta's % comes back down? Recommended: warn only for v1, add blocking once we've seen real numbers.
3. **Send thresholds:** are 30/h (warn) and 60/h (over) per account the right starting point?

---

## 8. Follow-up (not in this plan)

Make Sync incremental: only fetch details for messages we don't already
have, plus a periodic full repair. The meter will show whether this is worth doing.

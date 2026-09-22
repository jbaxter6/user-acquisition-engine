# Omnichannel Creator Acquisition Engine

A centralized, programmatic outbound engine for discovering, contacting, and managing conversations with music streamers/creators across Instagram, TikTok, and Twitch — without manually operating each platform or risking main brand accounts.

## The Problem

Manually finding, tracking, and messaging creators one-by-one is an operational bottleneck. Doing it by hand scales linearly and risks getting primary brand accounts flagged or banned for spam behavior.

## The Solution

A Social CRM + Automation Loop, unified under a single dashboard:

```
[ Automated Discovery & Scraping ]
               │
               ▼
[ Bulk Excel Upload ➔ Multi-Account Mass DM Sequence ]
               │
               ▼
[ The Unified Master Inbox (All socials routed to 1 tab) ]
```

## Core Modules

### 1. Automated Discovery (Scraping)
Plugs into data-scraping utilities (e.g. Modash, Phantombuster) to identify creators on Twitch, TikTok, and Instagram — filterable by follower range (e.g. 20k–200k) and content type (e.g. "Rate My Track," "Music Feedback" segments). Extracts handles, engagement rates, and public business emails into a clean spreadsheet.

### 2. Mass Distribution Layer (Multi-Account Slide)
Cold outreach is never sent from primary brand accounts. Instead, a network of satellite accounts is linked to the suite. Scraped spreadsheets are uploaded and the engine distributes send volume across accounts, at a low, deliberately conservative rate (currently targeting ~5 messages/day/account) using randomized human-like delays. Note: Meta's Instagram Messaging API is built for responding to conversations, not cold outreach, and its Platform Terms prohibit bulk/unsolicited messaging — even at low volume, sending from multiple accounts with the same pitch carries real ban risk that the API itself doesn't shield against. See "Instagram Setup" for what App Review realistically gates.

### 3. Unified Master Inbox
Replies from creators or their managers, across TikTok, Instagram, and Twitch, all route into one centralized dashboard tab. This enables:
- Simultaneous visibility into every active conversation across all networks
- A VA to triage, filter noise, and qualify interested leads
- Seamless handoff of hot leads for closing

## Why This Matters

1. **Compounding Velocity** — Scale outbound volume to hundreds of high-value targets per week, hands-free.
2. **Asset Protection** — Core brand accounts stay untouched by automation, protecting them from platform penalties.
3. **Operational Freedom** — Standardized discovery and inbound triage lets a cost-effective VA own ~90% of the daily workflow, freeing the team to focus on product and growth strategy.

## Tech Stack

- **Frontend**: React (Vite + TypeScript) — `client/`
- **Backend**: Node/Express (TypeScript) + SQLite — `server/`

## Unified Master Inbox — Implementation Notes

The inbox is built behind a platform-agnostic `MessagingAdapter` interface
(`server/src/adapters/`) so all three platforms are handled uniformly, but
their actual API access differs:

- **Instagram**: real integration via the Instagram API with Instagram Login
  (Business Login — no Facebook Page required), with an in-app "Connect
  Instagram" login (OAuth) that supports connecting multiple accounts (main +
  satellites), all feeding the same inbox — see Instagram Setup below.
  Sending is bound by Meta's 24-hour reply window — it's built for
  responding to conversations, not cold outreach.
- **TikTok**: no public DM API exists, so there's nothing to integrate
  against. Messages are logged manually via the inbox UI ("Log a
  TikTok/Twitch message").
- **Twitch**: the Whispers API is closed to new app registrations. If you
  already hold a whitelisted Twitch app from before it closed, its
  credentials can be wired into a real adapter the same way Instagram's is;
  otherwise, messages are logged manually like TikTok.

### Running it locally

```bash
# backend
cd server
cp .env.example .env   # fill in Meta app credentials once you have them (see below)
npm install
npm run dev             # http://localhost:4000

# frontend (separate terminal)
cd client
cp .env.example .env.local
npm install
npm run dev              # http://localhost:5173
```

Without any Instagram credentials configured, the app runs fully in manual
mode for all three platforms — the inbox UI works, "Connect Instagram" just
won't do anything useful until you've set up a Meta app (below).

### Instagram Setup

This uses Meta's **Instagram API with Instagram Login** ("Business Login") —
each Instagram Business/Creator account logs in directly, with no linked
Facebook Page required. Setup happens in Meta's dashboard, not in code:

1. Go to [developers.facebook.com](https://developers.facebook.com) →
   My Apps → Create App, type **Business**.
2. On the app dashboard, add the **Instagram** product, and use its
   **"API setup with Instagram login"** tab (not "API setup with Facebook
   login" — that's the older Page-based flow this project doesn't use).
3. That tab shows an **Instagram app ID** and **Instagram app secret**
   (separate from the top-level Facebook App ID under App Settings → Basic).
   Copy those into `server/.env` as `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
4. Click **"Add all required permissions"** in the same tab — adds
   `instagram_business_basic` and `instagram_business_manage_messages`
   (and `instagram_business_manage_comments`, unused here).
5. Add `http://localhost:4000/auth/instagram/callback` as a redirect URI on
   that same tab (matches `OAUTH_REDIRECT_URI` in `server/.env`).
6. **For each account you want to connect** (your main account, and every
   satellite account): go to Roles → Instagram Testers, add that Instagram
   Business/Creator account, then accept the tester invite from inside the
   Instagram app on that account (Settings → Apps and Websites → Tester
   Invites). While the app is in Development mode, only accounts added as
   testers can connect — App Review is what lifts that restriction (see
   the caveat under "Mass Distribution Layer" above about what that review
   is actually screening for).
7. Start both servers, open the app, click **Instagram accounts** in the
   header, then **"+ Connect an Instagram account"** — repeat once per
   account. Each connection is added to the list, not replaced.
8. For receiving messages, subscribe the app's webhook (Instagram product →
   Webhooks) to `POST /webhooks/instagram`, field `messages`, using
   `INSTAGRAM_VERIFY_TOKEN` from `server/.env` as the verify token. Incoming
   messages are matched to the right connected account automatically (Meta
   tells us which account received each message).

Every connected account's access token is stored in the local SQLite DB
(`server/data/inbox.db`), not `.env` — so connections persist across server
restarts without re-authorizing. The inbox shows which account each
conversation belongs to ("via @handle") so a VA handling multiple satellite
accounts can tell them apart at a glance.

## Status

Early-stage build. Unified Master Inbox (discovery/distribution modules not yet built) has a working React + Express + SQLite implementation with a real Instagram integration and manual-entry fallback for TikTok/Twitch.

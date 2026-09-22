# Work Log

## Todos
- [ ] Confirm a real DM now shows up correctly in the inbox UI, linked to the right account, after the webhook payload-format fix
- [ ] Once one account connects, add satellite accounts as Instagram Testers and connect each via "+ Connect another Instagram account"
- [ ] Re-verify the webhook Callback URL in Meta's dashboard every time ngrok restarts with a new URL (confirmed this is a real recurring gotcha during this session)
- [ ] Pass Meta App Review for `instagram_business_manage_messages` so accounts beyond registered testers can connect too (realistically may not pass given the cold-outreach use case — see README "Mass Distribution Layer" caveat)
- [ ] If an existing whitelisted Twitch app/credentials exist, wire a real `TwitchAdapter` (same pattern as `InstagramAdapter`)
- [ ] Choose scraping provider integration (e.g. Modash, Phantombuster) for the Discovery module
- [ ] Design satellite account linking/config mechanism for the Distribution module (multiple connected accounts, not just one)
- [ ] Add auth/login to the inbox app itself (currently unauthenticated, local-only)
- [ ] Replace SQLite with a shared/hosted DB before multi-VA or production use
- [ ] Fill in `INSTAGRAM_APP_SECRET` in `server/.env` (still blank as of last check) and restart the server before testing Connect/send
- [ ] Re-verify the ngrok webhook URL each time ngrok restarts (free tier issues a new random URL per run) — update the Callback URL on Meta's webhook config each time during local dev
- [ ] Click "Connect Instagram" for the main account (and each satellite, once tester invites are accepted) to confirm the OAuth flow works end-to-end
- [ ] Send a real test message to a connected account and confirm it lands in the inbox via the webhook

## Accomplishments
### 2026-09-22
- Debugged and fixed the webhook verification handshake failing with a 403: `server/.env` was stale (still had the pre-rewrite `INSTAGRAM_PAGE_ID`/`INSTAGRAM_PAGE_ACCESS_TOKEN` fields and an empty `INSTAGRAM_VERIFY_TOKEN`) from before the Instagram Login rewrite. Updated it to the current shape (`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `OAUTH_REDIRECT_URI`, `CLIENT_URL`, `INSTAGRAM_VERIFY_TOKEN`); `INSTAGRAM_APP_SECRET` still needs to be filled in by hand.
- Also hit an unrelated port conflict: a background server instance I'd started earlier for testing was still holding port 4000, fighting the user's own `npm run dev` (tsx watch) for the port and causing a force-kill restart loop. Cleared it.
- Diagnosed a 502 from ngrok as the local server simply not running (nothing listening on port 4000) — not an ngrok or code issue.
- User set up ngrok tunneling port 4000, pointed Meta's webhook Callback URL at `https://<ngrok-id>.ngrok-free.app/webhooks/instagram` with the matching verify token, and got it to verify and save successfully.
- Hit "Invalid redirect_uri" from Instagram's OAuth dialog: the redirect URI allowlist lives under a separate "Set up Instagram business login" section on the Instagram product page (step 4), not the webhook config (step 3) — wasn't configured yet. User registered the ngrok HTTPS callback URL there and updated `OAUTH_REDIRECT_URI` in `server/.env` to match.
- Got through the actual Instagram consent screen ("Allow") successfully, but the connect flow then failed with "Cannot read properties of undefined (reading '0')" — traced to `server/src/routes/auth.ts` assuming Meta's short-lived token exchange response is always wrapped as `{ data: [{ access_token, ... }] }` per Meta's docs, when the live response for this app apparently isn't. Made the parsing handle both the wrapped and flat (`{ access_token }`) response shapes, and added a server-side console log of the raw response so any future mismatch is easy to diagnose instead of guessing again.
- Account connected successfully, but no messages were arriving in the inbox. Root-caused via Meta's dashboard "Test" tool on the `messages` webhook field: connecting an account via OAuth does **not** automatically subscribe it to webhook events — each account needs an explicit `POST /{ig-user-id}/subscribed_apps?subscribed_fields=messages` call. Added that as an automatic step 4 in the connect flow (`server/src/routes/auth.ts`) so it happens for every account, including future satellites, without a manual step.
- After fixing the subscription, the dashboard's "Test" payload revealed the webhook *payload format itself* was wrong in the handler: real Instagram webhook events arrive as `entry[].changes[].field === "messages"` with the message data nested under `value`, not the Messenger-style `entry[].messaging[]` array the code originally assumed. Rewrote `server/src/routes/webhooks.ts` to parse the correct shape.
- Also diagnosed along the way: ngrok's free tier issues a new random URL on every restart, which silently breaks both the OAuth redirect and the webhook Callback URL until manually re-registered in Meta's dashboard — this tripped delivery more than once during testing.
- Added an Instagram account-connection (OAuth) flow so the app itself can log in, instead of requiring a manually pasted page access token in `.env`: `server/src/routes/auth.ts` implements the Meta Login for Business dialog, code→token exchange, long-lived token exchange, and Page/Instagram Business Account lookup.
- Added `instagram_account` table (`server/src/db.ts`) storing the connected account's page id/name and access token, so a connection persists across server restarts without re-authorizing.
- `server/src/adapters/index.ts` now builds the Instagram adapter dynamically per-request from the stored account (falling back to `INSTAGRAM_PAGE_ID`/`INSTAGRAM_PAGE_ACCESS_TOKEN` env vars for manual local testing), so a new connection takes effect immediately without a restart.
- Added a "Connect Instagram" control in the inbox header (`client/src/components/AccountConnection.tsx`) showing connection status and a disconnect action.
- Documented the Meta developer app setup steps required before the login flow can work (README "Instagram Setup") — this can't be done from code; it requires manually creating an app in Meta's dashboard.
- Verified both apps still typecheck and build after the changes, and smoke-tested `/auth/instagram/status` and `/auth/instagram/login` against a running server.
- Discovered (from the user's actual Meta dashboard) that the app is set up on **"API setup with Instagram login"** (Business Login), a distinct, Page-free flow from the Facebook-Page-based one originally implemented — different OAuth endpoints, scopes, and credentials (a separate Instagram App ID/Secret from the top-level Facebook App ID).
- Rewrote the Instagram integration to match: `server/src/routes/auth.ts` now uses `www.instagram.com/oauth/authorize` → `api.instagram.com/oauth/access_token` → `graph.instagram.com/access_token` (long-lived exchange) → `graph.instagram.com/me` (profile lookup); `server/src/adapters/instagram.ts` sends via `graph.instagram.com/{ig-user-id}/messages`. Verified against Meta's current docs via web search/fetch rather than guessing.
- Extended the data model for satellite accounts: replaced the single-row `instagram_account` table with a multi-row `accounts` table (`server/src/db.ts`), added `account_id` to `conversations` so each conversation is tied to the specific connected account that owns it, and the webhook handler now matches incoming messages to the right account via Meta's `recipient.id`.
- Updated the OAuth flow so each completed login adds a new account rather than overwriting the previous one — "Connect Instagram" can be clicked once per satellite account.
- Reworked the inbox UI: `AccountConnection` now lists all connected accounts with individual disconnect buttons and a "connect another" action; conversation list and thread view both show which connected account ("via @handle") owns each conversation, so a VA managing multiple satellites can tell them apart.
- Corrected the "Mass Distribution Layer" description in `README.md` to reflect the actual planned scale (~5 messages/day/account, not 50) and added an explicit caveat that Meta's Messaging API doesn't support cold outreach and that even low-volume multi-account messaging carries real ban risk independent of API compliance — surfaced this directly to the user rather than silently building around it.
- Verified both apps still typecheck and build clean after the rewrite, and smoke-tested `/api/health`, `/auth/instagram/accounts`, and the manual-conversation flow against a running server with the new schema.

### 2026-09-21
- Created `README.md` documenting the project vision, problem statement, and 3-module architecture (Discovery, Distribution, Unified Inbox).
- Set up `worklog` skill and this `WORKLOG.md` as the living record of todos, progress, and documentation links.
- Added GitHub Copilot equivalents (`.github/copilot-instructions.md` and `.github/prompts/worklog.prompt.md`) so the same worklog maintenance rules apply in Copilot Chat.
- Decided frontend will be built as a React app; recorded in `README.md` under a new Tech Stack section.
- Removed a stray auto-generated `# user-acquisition-engine` line that had been appended to the bottom of `README.md` (artifact of the GitHub repo's default README).
- Researched DM API availability per platform: Instagram has an official Messaging API (business-account, review-gated, reply-window restricted — not built for cold outreach); TikTok has no public DM API at all; Twitch's Whispers API is closed to new app registrations. Documented in `README.md`.
- Built the Unified Master Inbox as a working app: React + Vite + TypeScript frontend (`client/`) and Node/Express + TypeScript + SQLite backend (`server/`), connected by a REST API.
- Implemented a `MessagingAdapter` interface (`server/src/adapters/types.ts`) so all three platforms share one interface; `InstagramAdapter` is a real Meta Graph API integration (send + webhook receive), `StubAdapter` covers TikTok/Twitch (manual message logging only, since no send/receive API exists for them).
- Built inbox UI: conversation list with platform filter, thread view with reply composer, and a manual-entry form for logging TikTok/Twitch messages seen directly on-platform.
- Verified both apps build and boot cleanly (`tsc --noEmit`, `vite build`, live health-check + manual-message round trip against the running server).

## Documentation Index
- [Project Overview](README.md) — vision, problem statement, and 3-module architecture
- [Unified Master Inbox setup & platform API constraints](README.md) — how to run client/server, Instagram credential setup, why TikTok/Twitch are manual-only
- [MessagingAdapter interface](server/src/adapters/types.ts) — shared contract all platform adapters implement
- [Instagram adapter](server/src/adapters/instagram.ts) — real Instagram Graph API (graph.instagram.com) send integration, one instance per connected account
- [Instagram OAuth connect flow](server/src/routes/auth.ts) — Instagram Login (Business Login) OAuth: login/callback/accounts list/disconnect, supports multiple connected accounts
- [Instagram Setup walkthrough](README.md) — steps to create the Meta developer app needed for the connect flow to work
- [Inbox data model](server/src/db.ts) — SQLite schema for conversations/messages/connected accounts
- [Worklog rules (Claude)](.claude/skills/worklog/SKILL.md) — how WORKLOG.md is maintained, for Claude Code
- [Worklog rules (Copilot)](.github/copilot-instructions.md) — same rules, for GitHub Copilot Chat

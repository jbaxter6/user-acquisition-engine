# Outreach batches

> **Read [../IMPORTANT.md](../IMPORTANT.md) first.** The browser that sends must be logged into a throwaway social account, never a Smooth one.

This is the step after a sheet is uploaded. fuckem finds people, the scraper fills in their stats, and the Prospecting page holds the list. This runner walks that page and messages a small batch of people who have not been contacted yet.

Nothing in this folder runs yet. This is the plan for the runner.

## Where it sits

```
1. Find      fuckem    →  recruits/intercepts/
2. Enrich    scraper   →  recruits/dossiers/   (or leads/)
3. Upload    app       →  Prospecting page
4. Message   outreach  →  10–20 Not Contacted prospects per run
```

## Why a browser

The Prospecting page does not send the DM itself. On a Not Contacted card the action is **Copy & open**:

- It requires a message template.
- It copies that template onto the clipboard.
- It opens a new tab. Instagram goes to `https://ig.me/m/<username>`. TikTok goes to the profile (there is no DM link; Message is one more click). YouTube goes to the channel About tab, where a business email lives. Twitch has no open button, so those cards are skipped.

Meta's messaging API is for replies inside an existing conversation, not for starting these. TikTok and Twitch have no send API here at all. The send still happens in the social site, in a browser that is already logged into the throwaway. Playwright drives that the same way `war/scraper` and `war/fuckem` already do. Selenium would work, but the rest of WAR is Playwright, so this should be too.

## One run

A run messages one platform, with one template, then stops. The next run picks up whoever is still Not Contacted.

```
sign into the CRM
open Prospecting
click the "Not Contacted" filter
set the platform dropdown (Instagram, TikTok, or YouTube)
take the first BATCH_SIZE cards that still show a template picker
for each card:
  pick the template
  click "Copy & open in …"
  in the new tab, paste and send
  close the tab and wait
stop
```

`BATCH_SIZE` is between 10 and 20. The page loads 24 cards at a time, so one batch fits on the first page. Do not scroll for more in the same run.

The page already opens on Not Contacted. The click is still required, so a leftover "All" or "Awaiting Reply" filter cannot leak into the batch.

Skip any card that says **Continue in inbox**, or that has no **Copy & open** button. Those people are already in a thread.

## How they leave Not Contacted

Copy & open leaves the card on Not Contacted. For Instagram, the next Sync of the account that sent the DMs is what moves them.

Sync reads that account's conversations. When it finds a message we sent, and the other person's username matches a prospect still marked `new`, it sets that prospect to `contacted` (Messaged / Awaiting Reply). The message text is stored from Instagram. The template name is not, because Sync does not know which template was pasted.

That only happens if the throwaway that sent is the Instagram account connected in the CRM. Sync cannot see a send from an account that is not connected. Start the next batch after that sync, so the people just messaged are already off the Not Contacted list.

Until that sync, the same cards are still Not Contacted. The runner writes `sent.json` (not committed) after each send and skips those people, so a second run the same day does not message them again. If a send was clicked but the page never confirmed it, that person is stored as `unconfirmed` and skipped too. Check their thread, and delete that line from `sent.json` if the message is not there.

TikTok and YouTube have no sync. Those cards stay Not Contacted after a send. `sent.json` is what keeps the next run from opening the same ones. YouTube is not a DM: the runner opens the About tab, writes down a business email when one is on the page, and does not send mail.

## The two logins

Use one Chrome window, the same idea as `npm run chrome` in the scraper, so both sites keep their cookies.

| Site | Who is logged in |
|---|---|
| The CRM (`CRM_URL`, local or production) | The site password from the login page |
| Instagram or TikTok in that same window | A throwaway. Never a Smooth account. Copy the login from the app's Burners tab |

Check the social account before the first send, the same way [../IMPORTANT.md](../IMPORTANT.md) says to check it before a scrape. If it is a Smooth account, log out and stop.

## Pace

Stay slow on purpose. Same rules as [../fuckem/AGENTS.md](../fuckem/AGENTS.md):

- Wait a random gap between people (`MIN_DELAY_MS` to `MAX_DELAY_MS`), long enough that a batch of 10–20 is a sitting, not a burst.
- One platform and one template per run. One batch, then stop. Run again later for the next batch.
- On a captcha, a login wall, a "try again later", or a rate limit: stop. Leave the rest of the batch unsent. Do not retry through it, and do not swap accounts to get around it.
- Do not rotate identities or spoof the browser. The throwaway is one account, used openly.

## How to run

One-time setup:

```
cd war/outreach
npm install
npx playwright install chromium
cp .env.example .env
```

Fill in `.env`. `TEMPLATE_NAME` has to match a template on the Templates page exactly. Use `BATCH_SIZE=1` and `DRY_RUN=true` the first time. A dry run signs in, checks which social account is logged in, and does not open prospect tabs or send.

```
npm run chrome
```

In that window, log into the throwaway on Instagram or TikTok. Never a Smooth account. The runner checks the logged-in handle before the first send and stops if it is `movewithsmooth` or `smoothmediatechnologies`.

```
npm run batch
```

A normal batch is 10–20 people, with at least 15 seconds between them (the default gap is 45–90 seconds). On a captcha, a login wall, or a "try again later", the run stops and leaves the rest unsent.

## What the runner reads

Config lives in `war/outreach/.env` (not committed):

| Variable | Meaning |
|---|---|
| `CRM_URL` | The app, for example `http://localhost:5173` or the production site |
| `CRM_PASSWORD` | The site password. Omit it when the server has no `SITE_PASSWORD` |
| `PLATFORM` | `instagram`, `tiktok`, or `youtube` |
| `TEMPLATE_NAME` | Exact template name from the Templates page |
| `BATCH_SIZE` | 10–20 |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | Gap between sends. Both at least 15000. Defaults are 45000 and 90000 |
| `DRY_RUN` | `true` walks the CRM and does not open or send |
| `BLOCKED_HANDLES` | Extra accounts that must never send. The two Smooth handles are always blocked |
| `CHROME_CDP` | Defaults to `http://127.0.0.1:9222`, same as the scraper |

Twitch is out until the card has an open action. Instagram status is still left to the next Sync.

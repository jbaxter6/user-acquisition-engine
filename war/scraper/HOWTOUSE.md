# How to run the scraper

> **Never be logged into a Smooth social account in the scraper's browser.** Log in with a throwaway account only. Check before every run. Why: [../IMPORTANT.md](../IMPORTANT.md)

Results are saved as `.xlsx` files in `war/recruits/`.

## One-time setup

```
cd war/scraper
npm install
npx playwright install chromium
cp .env.example .env
```

## Every time

**Step 1: open the login browser** (leave it open, log into TikTok and Instagram in it with the **throwaway account, never Smooth**. Check which account is logged in every time.)
```
cd war/scraper
npm run chrome
```

**Step 2: in a second terminal, run a search**
```
cd war/scraper
npm run scrape -- --search instagram-music-reviews
```

That's it. Files show up in `war/recruits/`.

Each row has everything shown at the top of the profile: followers, following, posts (Instagram) or total likes (TikTok), verified, private, category, pronouns, bio, @mentions, links, highlights, email. Blank means the profile didn't show it. Upload the file on the app's Prospecting page; the columns map automatically and show up on the prospect cards. Re-uploading a newer sheet refreshes the numbers for people already in the app.

## Adding follower counts to a sheet that only has links

fuckem's sheets (and any sheet with Instagram/TikTok links) have no follower counts, because fuckem never opens the social profiles. With the Chrome from Step 1 open:

```
cd war/scraper
npm run enrich -- ../recruits/opp1-strat-2-2026-09-25_2346.xlsx
```

It opens each Instagram/TikTok profile and writes `<same name>-enriched.xlsx` next to it, with followers, following, bio, verified and the rest. Upload that one instead. YouTube/Twitch links come through without stats, and anyone whose profile won't load is kept with blank stats.

- `--min 1000 --max 50000` drops accounts outside a follower range (default: keep everyone).
- Stopped early (Ctrl-C, or it stops itself after 5 failed profiles in a row, which usually means Instagram is blocking)? Run the same command again: it skips everyone already done. Upload the `-partial` file too.
- `--refresh` redoes everyone.

## Stopping early

Press **Ctrl-C** (or close the terminal) any time. Whatever was found so far is saved to a file ending in `-partial.xlsx` in `war/recruits/`, so nothing is wasted. A crash partway through (rate limit, captcha) saves a `-partial` file the same way. Files are never overwritten: a second run the same day gets `-2`, `-3`, and so on.

## All searches (copy/paste one)

```
npm run scrape -- --search instagram-music-reviews
npm run scrape -- --search tiktok-live-music-reviews
npm run scrape -- --search tiktok-music-producers
npm run scrape -- --search tiktok-rate-my-track
npm run scrape -- --search twitch-music-feedback
```

Run everything at once: `npm run all`
See what searches exist: `npm run list`

## Adding a new search

1. Copy an entry in `searches.json` and change it.
2. Paste its command in the list above.

## If something goes wrong

- **"No Chrome found at http://127.0.0.1:9222":** do Step 1 first. If Chrome was already open, quit it fully (Cmd+Q) and rerun `npm run chrome`.
- **0 prospects:** the filters are probably too tight, or everyone was already collected. Rerun with `--no-dedupe`.
- **Rate limited or login lockout:** stop and wait a few hours. Don't keep retrying.
- Use a throwaway social account, never a Smooth account. See [../IMPORTANT.md](../IMPORTANT.md).

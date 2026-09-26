# How to run the scraper

Results are saved as `.xlsx` files in `war/recruits/`.

## One-time setup

```
cd war/scraper
npm install
npx playwright install chromium
cp .env.example .env
```

## Every time

**Step 1: open the login browser** (leave it open, log into TikTok and Instagram in it the first time)
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

- **"No Chrome found on port 9222":** do Step 1 first. If Chrome was already open, quit it fully (Cmd+Q) and rerun `npm run chrome`.
- **0 prospects:** the filters are probably too tight, or everyone was already collected. Rerun with `--no-dedupe`.
- **Rate limited or login lockout:** stop and wait a few hours. Don't keep retrying.
- Use a throwaway social account, not a main one.

# Scraper commands

Run everything from the `scraper/` folder. Results land in `scraper/output/` as `.xlsx`, ready to upload on the Prospecting page.

First-time setup:
```
cd scraper
npm install
npx playwright install chromium
cp .env.example .env    # only needed for Twitch (add your Twitch dev app keys)
```

## TikTok login (do this first)

```
npm run chrome     # opens a dedicated Chrome window; log into TikTok and Instagram there once (QR code is easiest)
```
Leave that window open, then run any TikTok search in another terminal. The scraper attaches to it and reuses the login (saved in ~/.outreach-chrome, so you only log in once). Fully quit that Chrome window before running `npm run chrome` again.

## Basics

```
npm run list                                    # show all saved searches (searches.json)
npm run all                                     # run every saved search + write a combined file
npm run scrape -- --search <name>               # run one saved search
npm run scrape -- --search <name1>,<name2>      # run several
```

## Saved searches (copy/paste)

```
npm run scrape -- --search tiktok-music-producers
npm run scrape -- --search tiktok-rate-my-track
npm run scrape -- --search twitch-music-feedback
npm run scrape -- --search tiktok-live-music-reviews
npm run scrape -- --search instagram-music-reviews
```

## Ad-hoc searches (not saved)

```
npm run scrape -- --source tiktok --category "music producer" --min 20000 --max 200000 --limit 5 --keywords "beats,producer"
npm run scrape -- --source twitch --category "Music" --limit 50 --keywords "rate,feedback"
```

Flags: `--source` (tiktok|tiktok-live|instagram|twitch), `--category` (search term), `--min`/`--max` (followers), `--limit`, `--keywords` (comma-separated, matched against bio/stream title).

## Skipping people we already have

Every run skips handles already in `seen.json` (everyone this machine scraped) and, if `OUTREACH_URL` and `SITE_PASSWORD` are set in `.env`, everyone already in the prod database. Add `--no-dedupe` to a command to turn this off.

## Adding a new search

1. Add an entry to `searches.json` (copy an existing one).
2. Add its copy/paste line under "Saved searches" above.

## Notes

- TikTok opens a visible browser. Solve any login/captcha in that window; leave it open until the run finishes. Use a throwaway account.
- Zero results usually means the filters are too tight. Try without `--keywords` and a wider `--min`/`--max`.

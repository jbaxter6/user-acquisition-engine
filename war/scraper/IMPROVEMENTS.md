# Scraper improvements

Ideas for making the scraper better, roughly in priority order. Check items off as they ship.

## Suggested first batch

- [x] 1. Dedup memory (`seen.json` + prod check) — done, see `src/known.ts`
- [x] 2. Handle-list mode — done as `npm run enrich -- <sheet>`, see `src/enrich.ts`
- [x] 3. Save results as we go — done as save-on-interrupt/crash, see `src/gracefulExit.ts`

Then 5 (more TikTok discovery) and 4 (scoring).

## 1. Stop rescraping and duplicating — DONE
- Local `seen.json` of every handle scraped; later runs skip them.
- Also checked against the prod database (`GET /api/prospects/handles`) so we never re-pitch someone already in the app.
- Known gap: handles filtered out by follower range are also remembered, so widening the range later needs `seen.json` cleared.

## 2. Handle-list mode
- `--handles file.txt` source that only reads public profiles for a supplied list.
- Fallback when TikTok/Instagram login is blocked; also useful for enriching lists from Modash or manual finds.

## 3. Resume and save as you go — DONE
- Ctrl-C, closing the terminal, `kill`, or a crash (rate limit, captcha) writes everything accepted so far to `<search>-<date>-partial.xlsx` and remembers those handles in `seen.json`.
- Sheets are never overwritten (`-2`, `-3`… suffixes). Same-day reruns used to overwrite the earlier sheet while its handles stayed in `seen.json`, which lost them for good.
- Not done: resuming an interrupted search where it stopped (a rerun just continues past the already-seen handles, which is close).

## 4. Better scoring, not just filtering
- Extra columns: engagement (recent views/likes ÷ followers), posting frequency, last post date, "music review" relevance score from bio/captions.
- Lets us sort the sheet by who is worth messaging first, not just follower range.

## 5. More discovery per search
- TikTok hashtag / video-search pages (surfaces far more creators than user search — this is what worked for Instagram).
- "Similar accounts" / seed mode: give it ~10 known good creators and look at who they follow, comment on, or are tagged with.

## 6. Email coverage
- Follow the link-in-bio (Linktree etc.) and read the page for an email.
- Click Instagram's "Email" button / read TikTok's business email where cheap.

## 7. Quality of life
- `--dry-run` that prints what it would search without opening anything.
- One command that launches Chrome and runs the search.
- Run summary saved next to each file: candidates, filtered out by followers, failed to load.
- Upload the `.xlsx` straight to the app's `/api/prospects/bulk` endpoint instead of manual import.

## 8. Reliability
- Health checks that flag when a selector/endpoint stops working (e.g. zero results from a search that used to return dozens).
- Small tests against saved page snapshots so TikTok/Instagram changes are caught quickly. **Started:** profile-header readers are tested against saved pages in `fixtures/` (`npm test`). Discovery (search pages) isn't covered yet.

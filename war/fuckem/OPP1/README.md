# OPP1 Strategies

## strat-1

<Explain what this strategy does>

## Output

Every strategy must return `{ prospects: [...] }` from `runStrategy()`. `run-opp1.js` saves each strategy's prospects to `war/recruits/intercepts/opp1/` (one folder per opp slot) via `lib/saveProspects.js` (file names use the slot numbers only, e.g. `opp1-strat-1-<timestamp>.xlsx`). A strategy that is runnable on its own should call `saveProspects` the same way `strat-1` does.

## strat-2

Types keywords into the page's search bar, collects the usernames it suggests, then loads each profile and saves the socials found there (Instagram, TikTok, YouTube, Twitch). Profiles with no socials are skipped.

- Keywords live in `strat-2/keywords.txt`, one per line. Add variations any time.
- The bar needs 3+ characters and shows at most 50 users per query. A query that returns 50 is split automatically (`mus` -> `musa`, `musb`, ...).
- Progress is remembered in `strat-2/.state.json` (git-ignored): finished queries and profiles are skipped on later runs, so each run finds new people. Delete it to start over.
- Each run is capped so it stays polite. Tune with env vars: `STRAT2_MAX_QUERIES` (default 300), `STRAT2_MAX_PROFILES` (200), `STRAT2_MAX_QUERY_LEN` (6), `STRAT2_TRIGRAMS=1` (also try every 3-letter combo), `STRAT2_RERUN=1` (redo finished queries).

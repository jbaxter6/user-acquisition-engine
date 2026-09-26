# How to run

> **Read [../IMPORTANT.md](../IMPORTANT.md) first:** never run WAR while logged into a Smooth social account. Use a throwaway.

A fuckem run is **only step 1 of 3.** Its sheet has social links but no followers, bio or anything else, so don't upload it yet.

```
1. Find      fuckem   →  recruits/intercepts/opp1/opp1-strat-2-<date>.xlsx     (links only)
2. Enrich    scraper  →  recruits/dossiers/opp1/opp1-strat-2-<date>-enriched.xlsx  (followers, bio, verified, ...)
3. Upload    app      →  Prospecting page, upload the file from dossiers/opp1/
```

## Where the sheets go

Everything lands in `war/recruits/`, split three ways:

| Folder | What's in it | Made by | Upload it? |
|---|---|---|---|
| `intercepts/opp1/`, `opp2/`, ... | Creators pulled straight from our competitors' opps, one folder per opp. **Links only.** | fuckem (step 1) | No. Enrich it first |
| `dossiers/opp1/`, `opp2/`, ... | Intercepts with full profile stats, in the same opp folders. | scraper `enrich` (step 2) | **Yes** |
| `leads/` | Open-web recruits from the scraper's own searches. Already have full stats. | scraper `npm run scrape` | **Yes** |

So: anything in `dossiers/` or `leads/` is ready for the app. Anything in `intercepts/` isn't yet.

None of these files are committed to git (the whole `recruits/` folder and every `.xlsx`/`.csv` in the repo are ignored). Keep them local.

## One-time setup

You need both folders set up, because step 2 uses the scraper.

```
cd war/fuckem
npm install
npx playwright install chromium
cp .env.example .env    # then fill in the OPP*_URL values

cd ../scraper
npm install
npx playwright install chromium
cp .env.example .env
```

## Step 1: Find (fuckem)

```
cd war/fuckem
npm run opp1          # runs every strategy in every OPP folder
npm run opp1strat1    # runs just OPP1/strat-1
npm run opp1strat2    # runs just OPP1/strat-2 (search-bar strategy)
```

This saves a sheet in that opp's folder, `war/recruits/intercepts/opp1/`, for example `opp1-strat-2-2026-09-25_2346.xlsx`. Each row is a creator from the opp with their Instagram, TikTok, YouTube or Twitch links. There are no stats yet, because fuckem never opens the social profiles.

## Step 2: Enrich (scraper)

This opens each Instagram and TikTok profile from the sheet and fills in the numbers.

**Terminal 1: open the login browser** and leave it open. Check that it's logged into the **throwaway** account on Instagram and TikTok, never a Smooth account.
```
cd war/scraper
npm run chrome
```

**Terminal 2: enrich the file from step 1**
```
cd war/scraper
npm run enrich -- opp1-strat-2-2026-09-25_2346.xlsx
```

Just the file name is enough; it looks through the opp folders in `intercepts/` for you. A full path works too.

This writes `opp1-strat-2-2026-09-25_2346-enriched.xlsx` to the matching opp folder, `war/recruits/dossiers/opp1/`.

Options:
- `--min 1000` leaves out accounts under 1,000 followers
- `--max 100000` leaves out accounts over 100,000 followers

  (Each profile is still opened to read its follower count. These only decide what goes in the file.)
- `--refresh` re-reads accounts already enriched from this sheet

Good to know:
- **It's slow on purpose:** 6 to 12 seconds per Instagram profile, 3 to 7 per TikTok. A few hundred accounts takes about an hour.
- **Stopping is safe:** Ctrl-C saves `-enriched-partial.xlsx`. Run the same command again and it skips everyone already done, writing a new `-enriched` file with **only the rest**. Upload both files in step 3.
- **It stops itself if blocked:** after 5 failed reads in a row on one platform, it saves a `-partial` file and stops. Wait a few hours before running it again. Don't keep retrying.
- **YouTube and Twitch** links are kept, but without stats (not read yet).
- Anyone whose profile won't load is kept, with blank stats.

## Step 3: Upload

On the app's **Prospecting** page, upload the **`-enriched.xlsx`** file from `dossiers/opp1/` (or whichever opp), not the original from `intercepts/`. If step 2 was stopped and resumed, upload every `-enriched` and `-enriched-partial` file it made for that sheet. The columns map automatically, and followers, bio and the rest show up on the prospect cards.

If you already uploaded the links-only sheet, upload the enriched one too. It fills in the numbers for the same people.

## Stopping early (step 1)

Press **Ctrl-C** (or close the terminal) any time. Whatever was found so far is saved to a file ending in `-partial.xlsx` in the opp's folder in `war/recruits/intercepts/`, so nothing is wasted. A crash partway through (rate limit, captcha) saves a `-partial` file the same way. Files are never overwritten: a second run the same day gets `-2`, `-3`, and so on.

A `-partial` file can be enriched in step 2 like any other.

## Adding a new script

1. Add the strategy folder (e.g. `OPP1/strat-2/run.js`).
2. Add a line for it in `package.json` under `scripts`.
3. Paste the command in the step 1 list above.

## If something goes wrong

- **"Missing OPP1_URL env var":** fill in `.env`.
- **0 prospects:** the page may have changed. Tell whoever owns the strategy.
- **Enrich says "No Chrome found":** start terminal 1 (`npm run chrome`) first. If Chrome was already open, quit it fully (Cmd+Q) and run it again.
- **Enrich says "Not logged into Instagram":** log the **throwaway** into Instagram in the browser window from terminal 1. It waits up to 5 minutes.
- **Enrich stopped after 5 failures:** Instagram or TikTok is blocking for now. Wait a few hours, then rerun the same command.
- **Uploaded sheet has no followers:** you uploaded the step 1 file from `intercepts/`. Upload the `-enriched` one from `dossiers/`.

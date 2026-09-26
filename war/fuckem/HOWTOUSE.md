# How to run

Results are saved as `.xlsx` files in `war/recruits/`.

## One-time setup

```
cd war/fuckem
npm install
npx playwright install chromium
cp .env.example .env    # then fill in the OPP*_URL values
```

## Run

```
cd war/fuckem
npm run opp1      # runs every strategy in every OPP folder
npm run opp1strat1    # runs just OPP1/strat-1
npm run opp1strat2    # runs just OPP1/strat-2 (search-bar strategy)
```

## Stopping early

Press **Ctrl-C** (or close the terminal) any time. Whatever was found so far is saved to a file ending in `-partial.xlsx` in `war/recruits/`, so nothing is wasted. A crash partway through (rate limit, captcha) saves a `-partial` file the same way. Files are never overwritten: a second run the same day gets `-2`, `-3`, and so on.

## Adding a new script

1. Add the strategy folder (e.g. `OPP1/strat-2/run.js`).
2. Add a line for it in `package.json` under `scripts`.
3. Paste the command in the list above.

## If something goes wrong

- **"Missing OPP1_URL env var":** fill in `.env`.
- **0 prospects:** the page may have changed. Tell whoever owns the strategy.

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
```

## Adding a new script

1. Add the strategy folder (e.g. `OPP1/strat-2/run.js`).
2. Add a line for it in `package.json` under `scripts`.
3. Paste the command in the list above.

## If something goes wrong

- **"Missing OPP1_URL env var":** fill in `.env`.
- **0 prospects:** the page may have changed. Tell whoever owns the strategy.

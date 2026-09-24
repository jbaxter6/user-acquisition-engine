# OPP1 Strategies

## strat-1

<Explain what this strategy does>

## Output

Every strategy must return `{ prospects: [...] }` from `runStrategy()`. `run-opp1.js` saves each strategy's prospects to `war/recruits/` via `lib/saveProspects.js` (file names use the slot numbers only, e.g. `opp1-strat-1-<timestamp>.xlsx`). A strategy that is runnable on its own should call `saveProspects` the same way `strat-1` does.

# Agent Rules

NEVER EVER EVER reference the opp names.

- Do not use friendly names, labels, or human-readable identifiers for opportunities.
- Do not mention or expose the actual opportunity names in code, comments, docs, logs, or prompts.
- Treat each opportunity as an environment-driven target only.

Required structure:
- Store each opportunity target in `.env` as its own variable: `OPP1_URL`, `OPP2_URL`, `OPP3_URL`, and so on
- Keep one folder per opportunity: `OPP1`, `OPP2`, `OPP3`, and so on
- Resolve the active implementation by reading the URL from the matching env var and loading that slot
- Do not guess by name; always resolve by the specific `OPP*_URL` value

The implementation must be dependent on the env URL, not on a guessed or human-defined opp name.

If a folder is needed for an opportunity, it must be keyed by the numeric slot, never by the opp's public name.

## Well-Behaved Automation

Every strategy must be a polite client. Stay under rate limits by design, not by evasion.

- Throttle requests and actions to a conservative, configurable pace (env-driven, e.g. `OPP_MIN_DELAY_MS`, `OPP_MAX_DELAY_MS`).
- Add jitter to delays so load is steady rather than bursty.
- On a 429, 403, captcha, or login challenge: back off exponentially, then stop the run. Never retry aggressively or try to bypass the block.
- Cap pages and actions per run and per day (env-driven).
- Cache results and never re-fetch a page already collected.
- Prefer an official API or data export when one exists.
- Do not rotate identities, spoof fingerprints, or otherwise work around a platform's anti-abuse controls.

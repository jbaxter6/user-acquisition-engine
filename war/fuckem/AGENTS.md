# Agent Rules

NEVER EVER EVER reference the opp names.

- Do not use friendly names, labels, or human-readable identifiers for opportunities.
- Do not mention or expose the actual opportunity names in code, comments, docs, logs, or prompts.
- Treat each opportunity as an environment-driven target only.

Required structure:
- Store all opportunity targets in `.env` as `OPP_URLS`
- Keep one folder per opportunity: `OPP1`, `OPP2`, `OPP3`, and so on
- Resolve the active implementation by reading the URL from `.env` and matching it to the correct folder
- Do not guess by name; always resolve by URL

The implementation must be dependent on the env URL, not on a guessed or human-defined opp name.

If a folder is needed for an opportunity, it must be keyed by the numeric or URL-derived slot, never by the opp's public name.

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

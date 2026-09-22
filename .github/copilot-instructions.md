# Repository instructions for GitHub Copilot

## Worklog maintenance

This repo keeps a living progress record at `WORKLOG.md` in the repo root. It
has three sections: `## Todos`, `## Accomplishments`, and `## Documentation
Index`. Keep it updated as described below — do this as part of finishing
work, not only when explicitly asked.

**Todos**
- Checkbox list, one short imperative line each (e.g. "Add Twitch scraper
  auth", not "We should probably think about auth at some point").
- When a todo is completed, remove it from Todos and add a corresponding line
  under today's date in Accomplishments — move it, don't just check it off.
- Add new todos only for follow-ups actually discussed or implied by the
  work just done; don't invent speculative ones.

**Accomplishments**
- Strictly chronological, oldest date at the top, newest at the bottom — read
  top to bottom like a history.
- Group same-day entries under one `### YYYY-MM-DD` heading; append to that
  heading if it already exists for today instead of creating a duplicate.
- Use the real current date, not a guess.
- One line per accomplishment, concrete: what changed and, if non-obvious,
  why. No filler ("worked on," "made progress on").
- Never rewrite or summarize past entries — only append new ones or move a
  completed todo into today's entry.

**Documentation Index**
- Whenever a doc (README section, architecture note, module-level doc, ADR,
  etc.) is created or substantially updated for some part of the code, add or
  update one line here linking to it.
- Format: `[Topic](path) — one-line description`, sorted by topic name.
- This is a pointer table only — don't duplicate documentation content here.

**Workflow**
- Read the current `WORKLOG.md` before editing it; make targeted edits
  (append to the right section, move completed todos, add doc-index rows)
  rather than rewriting the whole file.
- Keep entries terse — this file is scanned, not read start to finish, every
  time.

See `.github/prompts/worklog.prompt.md` for an explicit `/worklog` command
that runs this same update.

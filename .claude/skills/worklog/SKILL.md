---
name: worklog
description: Maintain WORKLOG.md, the project's living record of todos, accomplishments, and documentation links. Use whenever the user asks to log, track, or update project progress; whenever a meaningful chunk of work (a feature, fix, module, or decision) is completed in this project; or when the user asks "what's been done" or "what's left." Invoke proactively at the end of substantive work sessions in this repo, not just when explicitly asked.
---

# Worklog

Maintains `WORKLOG.md` at the project root as the single living document for this
project's progress: open todos, a dated log of completed work, and a pointer index
into documentation for specific parts of the codebase.

## File location

`WORKLOG.md` at the repository root. If it doesn't exist, create it using the
template below.

## Structure

The file has exactly three sections, in this order:

```markdown
# Work Log

## Todos
- [ ] Short, actionable item
- [ ] Another item

## Accomplishments
### YYYY-MM-DD
- What was done, stated as a completed fact, not a narrative.
- Second item for the same day.

### YYYY-MM-DD
- ...

## Documentation Index
- [Topic or module name](relative/path/to/doc.md) — one-line description of what it covers
```

## Rules

**Todos**
- Checkbox list, one line each, imperative/short phrasing ("Add Twitch scraper
  auth", not "We should probably think about adding auth at some point").
- When a todo is completed, remove it from Todos and add a corresponding line
  under today's date in Accomplishments. Don't leave completed items checked off
  in place — move them.
- If the user or the work surfaces a new follow-up, add it here. Don't invent
  speculative todos that weren't actually discussed or implied by the work.

**Accomplishments**
- Strictly chronological, oldest date at the top, newest date at the bottom —
  this is a log, read top to bottom like a history.
- Group same-day entries under one `### YYYY-MM-DD` heading; append to that
  heading's list if it already exists for today rather than creating a
  duplicate date section.
- Get today's date from the environment/system context, not by guessing.
- One line per accomplishment, stated concretely: what changed and, if
  non-obvious, why. No filler ("worked on," "made progress on").
- Do not rewrite or summarize past entries. Only append new ones or move a
  todo into today's entry.

**Documentation Index**
- Whenever a doc file (README section, architecture note, module-level doc,
  ADR, etc.) is created or substantially updated for some part of the code,
  add or update one line here linking to it.
- Keep entries as `[Topic](path) — one-line description`, sorted by topic
  name, not by date added.
- This index is a pointer table, not a place to duplicate documentation
  content.

## Workflow

1. Read the current `WORKLOG.md` before editing it (don't blindly overwrite).
2. Use Edit for targeted changes — append to the right section, move
   completed todos, add doc-index rows. Avoid rewriting the whole file.
3. After completing a task in this project (a fix, feature, refactor, doc,
   decision), update the log as part of finishing the task — don't wait to be
   asked, and don't bundle it as a separate user-facing announcement unless
   the user wants to see it.
4. Keep entries terse. This file is scanned, not read start to finish, every
   time — verbosity defeats its purpose.

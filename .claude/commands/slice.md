---
description: Implement one slice of a feature from its tasks/ todo file
---

Implement slice **$ARGUMENTS** of the current feature.

## Read first, in this order

1. `tasks/*-todo.md` — find the slice named in the argument and treat its task list as the checklist. Every unchecked box is in scope; nothing else is.
2. `tasks/*-plan.md` — the dependency graph, the risk notes for this slice, and where the checkpoints fall.
3. `docs/specs/*.md` — the spec the plan references. The sections the slice's tasks cite are the authority when the todo is terse.

If more than one feature has task files, ask which one before starting.

## Rules for the slice

- **Scope is the slice.** Do not start the next one, even if it looks trivial. An intermediate state that looks unfinished on screen is usually deliberate — the plan says so where it applies.
- **Stop at the checkpoint.** If the slice ends at a ⛔ CHECKPOINT, report the result and wait. Do not proceed past it.
- Tick the boxes in the todo file as you complete them.
- Follow the risk notes in the plan for this slice — they exist because that is where this codebase has bitten before.

## House rules (see CLAUDE.md)

- Everything lands in `zenit-week.html`. Single-file policy; `sw.js` is not a licence to split.
- `npm test` and `npm run validate` green before the slice is done.
- **`npm run csp` after any inline-script edit.** A stale hash blocks the entire script and presents as total breakage, not as a stale hash.
- EN and CS strings in the same edit — `tests/i18n.test.js` enforces parity.
- Never `innerHTML` with user-controlled data. Never native `confirm()`/`alert()`/`prompt()` — use `showAppConfirm`.
- No code, diffs or snippets in replies. Prose only.
- Summarise as a one-line commit message and ask before committing.

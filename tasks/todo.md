# TODO — Onboarding Part A: Seed Playground

Plan: `tasks/plan.md` · Spec: `docs/specs/onboarding-part-a-playground.md`
Order is strict: **S1 → S2 → S3 → S4** (each builds on the prior). Check off only when AC + verification pass.

## S1 — Seed embedding + first-run loader
- [x] T1.1 — `scripts/inject-playground-seed.mjs`: read `assets/playground-seed.json` → write into delimited constant block in `zenit-week.html`; wire into `build` npm script.
- [x] T1.2 — Add `/* PLAYGROUND_SEED_START/END */` block + `const PLAYGROUND_SEED`; run inject to populate (46 nodes, 4 colors).
- [x] T1.3 — `maybeSeedPlayground()` in init: trigger (empty DB ∨ `#playground`) + safety gate + `zenit-week-onboarded` flag.
- [x] T1.4 — Build seeded week: weekKey=today, stamp `_demo:true` + fresh `_ts`, `tombstones:[]`, `crdtVersion:0`, apply branch colors, `saveWeekIDB`, set flag, strip `#playground`.
- [x] T1.5 — `tests/onboarding-seed.test.js`: empty→seed, populated→no-op, `#playground` gate, flag blocks re-seed, nodes carry `_demo`, colors applied, no-clobber (6 tests).
- [x] T1.6 — `npm test` (505) + `npm run validate` green.
- [ ] **C1 checkpoint** — fresh-open browser; confirm aha; tune seed content if needed.

## S2 — `_demo` drop-on-touch
- [x] T2.1 — Implemented inside `touchNode(id, opts)` (the universal per-node mutation hook) rather than a separate helper — auto-covers all 37 mutation sites + future ones.
- [x] T2.2 — All mutators covered via `touchNode`: rename, move/drag, done, unplanned, priority, counter tick, add-child (touches parent; new node never gets `_demo`).
- [x] T2.3 — Bulk recenter-all (`:13854`) exempted via `touchNode(id,{keepDemo:true})`; color/theme/zoom/pan don't call `touchNode`.
- [x] T2.4 — `tests/onboarding-demo-touch.test.js`: touchNode drop + keepDemo + isolation + done/priority/unplanned mutators (6 tests).
- [x] T2.5 — `npm test` (511) + `npm run validate` green.

## S3 — Manual cleanup ("Clear example tasks")
- [x] T3.1 — `clearExampleTasks()`: removes only fully-untouched demo *subtrees* (never branches, never orphans a touched child) → snapshot/tombstone/save/render. + `hasDemoActivityNodes()` / `_subtreeAllDemo()` helpers.
- [x] T3.2 — Help-panel section `#help-onboarding-section` (`.agenda-action-btn.danger`), shown only while demo tasks remain, via `showAppConfirm({danger:true})`.
- [x] T3.3 — i18n EN+CS: `onboarding.clearTitle`, `clearHelpBody`, `clearExample`, `clearConfirmTitle`, `clearConfirmBody`, `clearConfirmOk`.
- [x] T3.4 — `tests/onboarding-cleanup.test.js`: partial-subtree retention, branches kept, child-array detach, undo restores, no-op, branch-ignoring count (6 tests).
- [x] T3.5 — `npm test` (517) + `npm run validate` green.
- [ ] **C2 checkpoint** — browser: play→cleanup→undo loop.

## S4 — Gentle auto-nudge banner
- [x] T4.1 — `shouldShowPlaygroundNudge()`: ≥5 user nodes (non-branch, non-demo, **non-`_editing`**) AND ≥1 demo remaining; `playgroundUserNodeCount()` helper. Trigger hooked into `saveWeek` (current week only). Threshold 5 + placeholder exclusion per review.
- [x] T4.2 — `#playground-nudge` banner: message + Clear (runs cleanup) + Dismiss; styled like existing toasts.
- [x] T4.3 — Once-only: in-session `_playgroundNudgeShown` + persisted `zenit-week-playground-nudged` flag (loaded at boot).
- [x] T4.4 — i18n EN+CS: `onboarding.nudge`, `onboarding.nudgeDismiss`.
- [x] T4.5 — `tests/onboarding-nudge.test.js`: count, <3→none, 3+demo→nudge, no-demo→none, flag→none, post-dismiss→none (6 tests).
- [x] T4.6 — `npm test` (523) + `npm run validate` green.
- [ ] **C3 checkpoint (final)** — full first-run journey on clean profile; sign-off.

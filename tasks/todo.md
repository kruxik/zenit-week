# TODO — Onboarding Part A: Seed Playground

Plan: `tasks/plan.md` · Spec: `docs/specs/onboarding-part-a-playground.md`
Order is strict: **S1 → S2 → S3 → S4** (each builds on the prior). Check off only when AC + verification pass.

## S1 — Seed embedding + first-run loader
- [ ] T1.1 — `scripts/inject-playground-seed.mjs`: read `assets/playground-seed.json` → write into delimited constant block in `zenit-week.html`; wire into `build` npm script.
- [ ] T1.2 — Add `/* PLAYGROUND_SEED_START/END */` block + `const PLAYGROUND_SEED`; run inject to populate.
- [ ] T1.3 — `maybeSeedPlayground()` in init (`:~14550`): trigger (empty DB ∨ `#playground`) + safety gate + `zenit-week-onboarded` flag.
- [ ] T1.4 — Build seeded week: weekKey=today, stamp `_demo:true` + fresh `_ts`, `tombstones:[]`, `crdtVersion:0`, apply branch colors, `saveWeekIDB`, set flag, strip `#playground`.
- [ ] T1.5 — `tests/onboarding-seed.test.js`: empty→seed, populated→no-op, `#playground` gate, flag blocks re-seed, nodes carry `_demo`.
- [ ] T1.6 — `npm test` + `npm run validate` green.
- [ ] **C1 checkpoint** — fresh-open browser; confirm aha; tune seed content if needed.

## S2 — `_demo` drop-on-touch
- [ ] T2.1 — `clearDemo(nodeId)` helper.
- [ ] T2.2 — Hook mutators: rename commit, move/drag, done, unplanned, priority, counter tick, add-child/add-node (+ `clearDemo(parent)`).
- [ ] T2.3 — Verify color/theme/zoom/pan are NOT touches.
- [ ] T2.4 — Tests: one case per mutator drops flag; untouched node keeps it.
- [ ] T2.5 — `npm test` green.

## S3 — Manual cleanup ("Clear example tasks")
- [ ] T3.1 — Cleanup fn: snapshot → tombstone+remove `_demo` nodes (keep branches) → rebuild/save/render.
- [ ] T3.2 — Help-panel entry (`.agenda-action-btn`) via `showAppConfirm({danger:true})`.
- [ ] T3.3 — i18n EN+CS: `onboarding.clearExample`, `clearConfirmTitle`, `clearConfirmBody`, `clearConfirmOk`.
- [ ] T3.4 — Tests: touch 2 → cleanup removes only untouched demo, branches intact, undo restores.
- [ ] T3.5 — `npm test` + `npm run validate` green.
- [ ] **C2 checkpoint** — browser: play→cleanup→undo loop.

## S4 — Gentle auto-nudge banner
- [ ] T4.1 — Threshold logic: ≥3 real user nodes AND ≥1 demo remaining.
- [ ] T4.2 — Dismissible banner: message + Clear (runs S3) + Dismiss.
- [ ] T4.3 — Once-only `zenit-week-playground-nudged` flag.
- [ ] T4.4 — i18n EN+CS: `onboarding.nudge`, `onboarding.nudgeDismiss`.
- [ ] T4.5 — Tests: 2 nodes→no nudge; 3+demo→nudge; flag set→no nudge.
- [ ] T4.6 — `npm test` + `npm run validate` green.
- [ ] **C3 checkpoint (final)** — full first-run journey on clean profile; sign-off.

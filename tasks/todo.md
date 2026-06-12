# TODO — Stats Panel: Plan vs Reality

Plan: `tasks/plan.md` · Spec: `SPEC.md` · Branch: `feature/stats-panel`

## Phase 1 — Foundation
- [x] **T1** Extract `computeWeekStats()` + unit tests
  - [x] Pure helper → `{ global, perBranch, leaves }` with `counts` + `weighted` lenses
  - [x] Counter = one task (done iff `val>=max`) in counts; fractional in weighted; `_editing` excluded
  - [x] Refactor `updateSummary()` to consume it — DOM output unchanged
  - [x] Export `computeWeekStats` in `tests/setup.js`
  - [x] New `tests/stats.test.js` (12 tests: global/per-branch counts, counter semantics, edge cases)
  - [x] Verify: `npm test` 490/490 (incl. `summary.test.js` regression); `npm run validate` clean
- [ ] **CHECKPOINT A** — human review (no UI yet)

## Phase 2 — Shell + entry
- [x] **T2** Panel shell + clickable summary-box entry
  - [x] `#stats-panel` + `#stats-overlay` (help-dialog pattern); `openStatsPanel`/`closeStatsPanel`/`renderStatsPanel`
  - [x] `#summary-header` → native `<button>` (Enter/Space free); replaces inline expand
  - [x] Esc + overlay + ✕ + mobile pill close; re-render while open via `updateSummary` hook (added `unplanned` to summary signature)
  - [x] No `weekData` mutation, no undo entry (verified: undo btn stays disabled across open/close)
  - [x] i18n `stats.title`/`stats.open`/`stats.close` (EN+CZ); reuse `.help-section`/`.help-close-btn`
  - [x] Verify: `npm test` 490/490; `npm run validate` clean; browser open/close/keyboard OK

## Phase 3 — Sections
- [ ] **T3** Section ① donut + 3 headlines (counts; center = completion %)
  - [ ] 4-arc SVG donut, div-by-zero guarded, global/branch-independent
  - [ ] Plan completion / Unplanned load (x/y) / Unplanned completion
  - [ ] Verify: manual vs hand-computed; light+dark; 3 vs 8 branches identical
- [ ] **CHECKPOINT B** — human review (first visible slice)
- [ ] **T4** Section ② branch-tinted stacked bars (counts)
  - [ ] Per-branch bar tinted `BRANCH_COLORS`; done solid / open faded / unplanned hatched
  - [ ] DOM-constructed labels (no innerHTML w/ branch text); zero-task branch clean
  - [ ] Verify: manual 3 and 8 branches, light+dark; segments sum to total
- [ ] **T5** Section ③ reuse ratio-bar + baseline (weighted)
  - [ ] Branch share + total-vs-baseline via shared helper weighted lens
  - [ ] Verify: panel figures == top-box figures; overload color same threshold

## Phase 4 — Hardening
- [ ] **T6** Empty / positive states
  - [ ] Empty week clean; tasks-but-none-unplanned → positive message, 0 headlines clean
  - [ ] Verify: manual empty + all-planned weeks
- [ ] **T7** Responsive (mobile lean)
  - [ ] Mobile: ① + headlines + ③ ratio-bar; compact ②; hide ④ (CSS breakpoints only)
  - [ ] Verify: manual ~375px and ~1280px; no overflow
- [ ] **T8** Theming / i18n / a11y / validate
  - [ ] EN+CZ strings via `t()`; full light/dark via tokens; keyboard + SR labels + focus
  - [ ] Security: no innerHTML/outerHTML/insertAdjacentHTML with weekData-derived values
  - [ ] Reuse `.agenda-action-btn`; no orphan classes
  - [ ] Verify: `npm test` + `npm run validate` green; manual F7/F8 matrix
- [ ] **CHECKPOINT C** — human review · **MVP merge candidate**

## Phase 5 — Fast-follow
- [ ] **T9** Section ④ desktop-only timeline (Mon→Sun from doneAt/ticks/unplannedAt)
  - [ ] Hidden on mobile; no dead DOM if deferred
  - [ ] Verify: buckets match daily-log; hidden on mobile; validate clean
- [ ] **CHECKPOINT D** — human review · ship fast-follow

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
- [x] **T3** Section ① donut + 3 headlines (counts; center = completion %)
  - [x] 4-arc SVG donut (planned/unplanned × done/open), div-by-zero guarded, global → branch-independent
  - [x] Plan completion / Unplanned load (x/y) / Unplanned completion + 4-swatch legend
  - [x] Branch-tinted scheme: green=planned, amber=unplanned; done solid, open faded (0.32)
  - [x] i18n EN+CZ (planVsReality, 3 headlines, 4 legend labels)
  - [x] Verify: geometry exact (arcs sum 100, headlines = hand-math); browser light+dark professional; empty state clean; `npm test` 490/490, `npm run validate` clean
- [ ] **CHECKPOINT B** — human review (first visible slice)
- [x] **T4** Section ② branch-tinted stacked bars (counts)
  - [x] Per-branch bar tinted `BRANCH_COLORS.main`; done solid / open faded (rgba alpha) / unplanned hatched
  - [x] Hatch is a separate background-image layer (`--stats-hatch` theme token) so faded segments keep crisp hatch
  - [x] Neutral status legend (done/open/unplanned); per-branch `done / total · N unplanned` label
  - [x] DOM-constructed labels (textContent); zero-task branch → clean empty track
  - [x] i18n EN+CZ (followThrough, unplannedShort, 3 legend labels)
  - [x] Verify: browser 3 + 8 branches, light+dark distinguishable; 8 branches no h-overflow, scrolls; `npm test` 490/490, validate clean
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

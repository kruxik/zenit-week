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
- [x] **T5** Section ③ reuse ratio-bar + baseline (weighted)
  - [x] Extracted shared `_effortLevel`/`_effortColor`/`_effortTooltipKey` from updateSummary (no dup math)
  - [x] Load number (effort-colored) + `/ baseline N` + threshold note; branch-share ratio bar reuses `.ratio-segment`
  - [x] Only weighted-lens section; figures == top box by construction (summary.test green)
  - [x] i18n EN+CZ (effortBalance, baseline)
  - [x] Verify: stretch=amber@118, segments 51/29/20 sum 100; browser light; `npm test` 490/490, validate clean

## Phase 4 — Hardening
- [x] **T6** Empty / positive states
  - [x] Empty week (total 0) → friendly message + hint (reuses `.daily-log-empty`); other sections cleared, no charts
  - [x] All-planned (unplanned 0) → green positive pill "No unplanned tasks 👍"; donut planned-only; 0-headlines clean (div-by-zero guarded)
  - [x] i18n EN+CZ (emptyWeek, emptyWeekHint, noUnplanned)
  - [x] Verify: browser empty + all-planned states; `npm test` 490/490, validate clean
- [x] **T7** Responsive (mobile lean)
  - [x] `@media (max-width:767px)`: tighten padding/gaps, donut row wraps, headlines shrink, hide ④ timeline
  - [x] ② bars already label-free (compact); panel mobile chrome (full-area + bottom Close pill) from T2
  - [x] Verify: browser mobile (all of ①②③, timeline hidden, bottom pill) + desktop unaffected; `npm test` 490/490, validate clean
- [x] **T8** Theming / i18n / a11y / validate
  - [x] i18n: EN+CZ parity (21 keys each, diffed) + new automated parity test in i18n.test.js
  - [x] Theming: stats CSS uses only tokens; light+dark verified across all sections
  - [x] Security: zero innerHTML/outerHTML/insertAdjacentHTML with weekData-derived values (textContent/createElementNS)
  - [x] a11y: dialog roles+labels, role=img donut, native buttons, focus management (trigger→close→trigger), Esc/keyboard
  - [x] Reuse: native buttons + `.help-close-btn`; no orphan button classes
  - [x] Verify: `npm test` 491/491; `npm run validate` clean; full F7/F8 matrix (themes × widths × 3/8 branches × empty/unplanned)
- [x] **CHECKPOINT C** — human review · **MVP merge candidate**

## Phase 5 — Fast-follow
- [ ] **T9** Section ④ desktop-only timeline (Mon→Sun from doneAt/ticks/unplannedAt)
  - [ ] Hidden on mobile; no dead DOM if deferred
  - [ ] Verify: buckets match daily-log; hidden on mobile; validate clean
- [ ] **CHECKPOINT D** — human review · ship fast-follow

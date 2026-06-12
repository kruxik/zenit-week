# Plan — Stats Panel: Plan vs Reality

> Spec: `SPEC.md` · Idea: `docs/ideas/stats-panel-plan-vs-reality.md`
> Branch: `feature/stats-panel` · Single file: `zenit-week.html`
> Task list: `tasks/todo.md`
> (Previous feature — multi-tab editing — shipped; this file repurposed. History in git.)

## Code anchors (verified)
- Current stats: `updateSummary()` `zenit-week.html:~9716` — leaf detection, `getStats()`
  (priority-weighted, counters fractional `val/max`), per-branch loop, baseline color
  (`wBaseline`/`wOverload`), ratio-bar rebuild.
- Summary box markup `#placeholder-panel` / `#summary-header` / `#summary-details` /
  `#ratio-bar`: `:3160–3167`; styles `:2770–2820`.
- Helpers to reuse: `getPriorityWeight` `:7409`, `findNode` (O(1) `nodeMap`),
  `BRANCH_COLORS[branch].main`, `t(key)` + `TRANSLATIONS` (EN `:~6000`, CZ `:~6200`).
- Panel pattern (`is-open` open/close, Esc, backdrop): Quick-add `:13320–13412`.
- Icon sprite sheet (add `<symbol>` if needed): `:~2994–3045`.
- Day-key data for timeline (T9): `doneAt`, counter `ticks[]`, `unplannedAt` — same
  fields the daily-log uses.
- Button reuse: `.agenda-action-btn` only (no orphan classes).
- Test harness: `tests/setup.js` extracts `<script id="app-script">` into a VM, exports
  destructured top-level fns (list ~`:525`); add `computeWeekStats` there.
  Regression guard: `tests/summary.test.js` must stay green after T1.

## Dependency graph
```
T1 computeWeekStats() + tests           [FOUNDATION — single source of truth]
        │
   ── T2 panel shell + clickable summary-box entry ──  [shared infra]
        │
   ┌────┼────────────┬──────────────┐
   ▼    ▼            ▼              │
  T3   T4           T5             │
 ① donut  ② branch   ③ ratio-bar    │
 +headlines  bars     +baseline    │
   └────┴────────────┘             │
            ▼
        T6 empty / positive states
            ▼
        T7 responsive (mobile lean)
            ▼
        T8 theming / i18n / a11y / validate   ◀── MVP MERGE CANDIDATE
            ▼
        T9 ④ desktop-only timeline   ◀── FAST-FOLLOW (separate merge OK)
```
T1 is the linchpin; T2 is shared infra; T3–T5 are independent slices.

## Checkpoints
- **CP-A** (after T1): `npm test` green — new `computeWeekStats` tests **and** existing
  `summary.test.js` pass (proves extraction didn't move the top-box numbers). No UI yet.
- **CP-B** (after T3): panel opens from the box; donut + headlines correct on canonical
  data, light + dark. First visible end-to-end slice.
- **CP-C** (after T8): full F7/F8 matrix manual pass (themes × widths × 3/8 branches ×
  empty/unplanned); `npm test` + `npm run validate` green. **MVP merge candidate.**
- **CP-D** (after T9): timeline verified desktop-only, hidden on mobile.

---

## Phase 1 — Foundation

### T1 · Extract `computeWeekStats()` + unit tests
Pure top-level `computeWeekStats()` → `{ global, perBranch }`, each with **both** lenses:
- `counts`: `{ plannedDone, plannedOpen, unplannedDone, unplannedOpen, total, done,
  completionPct }` — counter = **one task**, done iff `val>=max`; `_editing` excluded;
  leaf = no active non-`_editing` children (same predicate as `updateSummary`).
- `weighted`: `{ done, total, percent }` — priority-weighted, counters fractional
  `val/max` (identical math to today).
Refactor `updateSummary()` to consume it with **byte-identical** DOM output. Add
`computeWeekStats` to the `tests/setup.js` export destructure.

Acceptance:
- [ ] SPEC F2/F3 count semantics + F4 weight semantics implemented in one helper.
- [ ] `updateSummary` output unchanged (top box identical).
Verify:
- [ ] New `tests/stats.test.js`: global + per-branch counts; counter (counts vs weighted);
      `_editing` exclusion; empty week; branch-with-no-tasks; all-planned; all-unplanned;
      priority weighting.
- [ ] `npm test` → `summary.test.js` **and** new tests green.

**CHECKPOINT A** — human review. No UI yet.

---

## Phase 2 — Shell + entry

### T2 · Panel shell + clickable summary-box entry
- New panel container + backdrop using the `is-open` pattern (Quick-add `:13336`).
- `openStatsPanel()` / `closeStatsPanel()` / `renderStatsPanel()` (empty section slots).
- `#placeholder-panel` becomes a button: role, `tabindex`, `aria-label`, `Enter`/`Space`
  open; replace inline expand with open-panel.
- `Esc` + backdrop + ✕ close; re-render while open on data change.

Acceptance:
- [ ] SPEC F1. Open/close never mutates `weekData`, creates **no undo entry**.
Verify:
- [ ] Manual: click/keyboard opens; Esc/backdrop/✕ close; edit while open → refresh;
      undo stack unchanged after open/close. `npm run validate` clean.

---

## Phase 3 — Sections (vertical slices)

### T3 · Section ① Plan vs Reality (donut + 3 headlines)
SVG donut, 4 arcs fixed order (planned-done, planned-open, unplanned-done,
unplanned-open), center = overall completion %. Three count headlines: Plan completion,
Unplanned load (`x / y`), Unplanned completion. From `computeWeekStats().global.counts`.
Acceptance: [ ] SPEC F2; global/branch-independent; div-by-zero guarded.
Verify: [ ] Manual — arcs + center % + headlines match hand-computed; light + dark;
identical at 3 vs 8 branches.

**CHECKPOINT B** — human review (first visible slice).

### T4 · Section ② Follow-through (branch-tinted stacked bars)
One stacked bar per live branch (branch order), 4 status segments by count, tinted with
`BRANCH_COLORS[branch].main`; status via shade/opacity (done solid / open faded /
unplanned hatched — SVG `<pattern>` or CSS); per-branch count label. DOM-construct
labels (no `innerHTML` with branch text).
Acceptance: [ ] SPEC F3; 8 branches scroll, no clip; statuses distinct within one hue
both themes; zero-task branch = clean empty bar.
Verify: [ ] Manual at 3 and 8 branches, light + dark; segments sum to branch total.

### T5 · Section ③ Effort & Balance (reuse ratio-bar + baseline)
Branch share of **weighted** load + total-vs-baseline via `computeWeekStats().*.weighted`
+ existing baseline/stretch/overload color + tooltip logic. Reuse, no re-impl.
Acceptance: [ ] SPEC F4; numbers equal top box; only weighted section in panel.
Verify: [ ] Manual — balance figures = top-box figures; overload color flips same threshold.

---

## Phase 4 — Hardening

### T6 · Empty / positive states
Empty week → friendly empty state, no broken charts. Tasks-but-none-unplanned →
positive message ("No unplanned tasks this week 👍"); donut shows planned only;
unplanned headlines read 0 cleanly.
Acceptance: [ ] SPEC F6. Verify: [ ] Manual — empty + all-planned weeks render clean.

### T7 · Responsive (mobile lean)
CSS breakpoints only. Mobile: keep ① + headlines + ③ ratio-bar; compact ② (bar +
counts, no inline labels); hide ④. Desktop: all.
Acceptance: [ ] SPEC F7, ~375px and ~1280px. Verify: [ ] Manual both widths; no overflow.

### T8 · Theming / i18n / a11y / validate
All strings → `TRANSLATIONS` EN + CZ via `t()`; full light/dark via tokens; keyboard +
SR labels + focus management; security sweep: zero `innerHTML`/`outerHTML`/`insertAdjacentHTML`
with `weekData`-derived values; reuse `.agenda-action-btn`, no orphan classes.
Acceptance: [ ] SPEC F8 + boundaries.
Verify: [ ] `npm test` + `npm run validate` green; manual F7/F8 matrix; grep new-code
`innerHTML` = static only.

**CHECKPOINT C** — human review. **MVP merge candidate** (F1–F8 minus timeline).

---

## Phase 5 — Fast-follow

### T9 · Section ④ The Week timeline (DESKTOP-ONLY)
Mon→Sun strip from `doneAt` / counter `ticks[]` / `unplannedAt`: per-day completions +
unplanned arrivals. Hidden on mobile; no dead DOM if shipped later. May merge after F1–F8.
Acceptance: [ ] SPEC F5. Verify: [ ] Manual — buckets match daily-log; hidden on mobile;
validate clean.

**CHECKPOINT D** — human review. Ship fast-follow.

---

## Risks & mitigations
- **Top box drifts after T1** → `summary.test.js` fails loudly = intended guardrail.
- **Counter-in-counts ambiguity** → default "one task, done iff at max"; confirm in T3.
- **Unplanned shading legibility at 8 hues / dark mode** → pick hatch vs opacity in T4.
- **Scope creep** → no snapshot model, no cross-week, no export/edit (SPEC "Never").

## Out of scope (SPEC §7)
Plan-snapshot/frozen-baseline data model · cross-week/historical analytics · export/share ·
editing from panel · browser-native dialogs · orphan button classes · file split.

## Workflow
Each task ends with a one-line commit message + "Should I add and commit?" (project rule).
Atomic commit per task on `feature/stats-panel`.

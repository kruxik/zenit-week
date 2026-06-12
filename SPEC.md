# SPEC — Stats Panel: Plan vs Reality

> Source idea: `docs/ideas/stats-panel-plan-vs-reality.md`
> Branch: `feature/stats-panel` (off `main`)
> Scope: net-new feature, single-file (`zenit-week.html`). No data-model change.

---

## 1. Objective

Give the user a dedicated, professional **Stats panel** that answers "how did my week go vs. the plan?" in one glance: how much got done, where it slipped, and how much unplanned work crashed in. The existing tiny top summary box stays as the always-on glance; the new panel is the deliberate "lean back and reflect" surface, opened by clicking that box.

**Target user:** the existing single user — plans the week Mon morning / Sun evening, flags unplanned tasks with `U` during the week, reflects at week's end. Works with 3 branches normally, occasionally 4–8.

**Success:** opening the panel, the user immediately reads (a) plan completion, (b) unplanned load & its completion, (c) per-branch follow-through, (d) effort balance vs. baseline — accurately, in both light/dark, on desktop and mobile, at any branch count.

---

## 2. Features & Acceptance Criteria

### F1 — Entry point: clickable summary box
- The existing summary box (`#placeholder-panel`) becomes the panel trigger.
- **AC:** Clicking/tapping the box opens the Stats panel. It exposes a button role + keyboard focus + `aria-label`; `Enter`/`Space` opens it. Its current expand/collapse behavior is replaced by "open panel" (the panel supersedes the inline expand).
- **AC:** `Esc` closes the panel (consistent with app `Esc` convention); clicking a backdrop/close button closes it.
- **AC:** Opening/closing the panel does not mutate `weekData` and produces no undo entry.

### F2 — Section ①: Plan vs Reality (hero)
- A hand-built **SVG donut**, four arcs in fixed order: planned-done, planned-open, unplanned-done, unplanned-open. Center shows **overall completion %** (matches top-box meaning).
- Three headline metrics beside it, **priority-weighted** (revised — see note below):
  - *Plan completion* — planned-done ÷ planned total.
  - *Unplanned load* — unplanned ÷ all load (e.g. "59 / 169").
  - *Unplanned completion* — unplanned-done ÷ unplanned total.
- **AC:** Computed over **leaf nodes** using the same leaf definition as `updateSummary()` (a node with no active, non-`_editing` children; counters are leaves), **priority-weighted** (critical 5×, high 3×, normal 1×). A counter contributes `val` of its weight as done and `max-val` as open (partial progress counts fractionally), so the donut centre % equals the summary-box %.

  > **Revised after T1 (user decision):** the panel originally used task counts for ①② and weighting only for ③ ("mixed metrics"). That produced a donut % that diverged from the weighted summary box (e.g. 53% vs 50%). Per user direction, **①②③ are now all priority-weighted** — one consistent metric, donut matches the box. The headline raw figures are weighted "points", not task counts.
- **AC:** Donut is **global** (not per-branch) and renders identically for 3 or 8 branches.
- **AC:** Division-by-zero guarded (empty week → see F6).

### F3 — Section ②: Follow-through (per-branch stacked bars)
- One horizontal **stacked bar per live branch**, in branch order, segmented plan-done / plan-open / unplanned-done / unplanned-open, **priority-weighted** (same lens as ①, revised from task counts).
- Each bar is **tinted with its branch color** (`BRANCH_COLORS[branch].main`); status encoded by shade/opacity: **done = solid, open = faded, unplanned = hatched** (SVG `<pattern>` or CSS). A compact per-branch label (`done / total · N unplanned`, weighted points) sits with the bar.
- **AC:** Bars stack vertically and scroll; 8 branches render without overflow/clipping.
- **AC:** Branch identity (color + label + legend dot) is unambiguous in both themes; done/open/unplanned are visually distinguishable within a single branch hue (verify at 8 branches, both themes).
- **AC:** A branch with zero leaf tasks renders an empty/zero bar, not a broken one.

### F4 — Section ③: Effort & Balance
- **Reuse** the existing ratio-bar + baseline logic from `updateSummary()` (priority-weighted load via `getPriorityWeight`; baseline/stretch/overload color thresholds `wBaseline` / `wOverload`).
- Show branch share of weighted load + total load vs. baseline with the existing color + tooltip semantics.
- **AC:** This is the **only** section using weighted load; numbers match what the top box would show for the same week.
- **AC:** No duplication of the weighting math — factor a shared helper if reuse requires it (see §4).

### F5 — Section ④: The Week (timeline) — DESKTOP ONLY
- Mon→Sun view from `doneAt` / counter `ticks[]` / `unplannedAt`, showing per day: completions and unplanned arrivals.
- **Layout (revised):** rendered as a **vertical day-list in the 3rd column of the hero/donut row** (right of the headlines), filling the otherwise-empty desktop space — not a full-width strip at the bottom. Each day is a row: 2-letter label + two horizontal bars (green completed, amber unplanned arrived), scaled to the week's busiest day, today's row bolded. Desktop panel widened to 780px to fit the third column.
- **AC:** Hidden entirely on mobile (the `.stats-timeline-col` column is `display:none` < 768px; the donut row collapses to donut + headlines). No dead DOM.

### F6 — Empty / positive states
- No tasks at all → friendly empty state, no broken charts.
- Tasks exist but none unplanned → **positive** message ("No unplanned tasks this week 👍"), donut still shows planned-done/open; unplanned headlines read 0 cleanly. Not framed as a warning — flagging is the user's choice.

### F7 — Responsive
- Same DOM, CSS breakpoints only (match app's existing `@media`, e.g. 56px-toolbar context).
- **Mobile:** show ① donut + headlines and ③ ratio-bar + baseline; **compact** ② (bar + counts, no inline segment labels); **hide** ④.
- **Desktop:** all sections full.
- **AC:** Verified at a narrow (~375px) and wide (~1280px) width.

### F8 — Theming, i18n, a11y, security
- **AC:** Full light + dark theming via existing CSS custom properties; no hard-coded colors except chart-status shades derived from branch/theme tokens.
- **AC:** All user-facing strings added to `TRANSLATIONS` for **EN and CZ**, read via `t(key)`. No hard-coded UI text.
- **AC:** Panel is keyboard-operable and screen-reader-labeled (headings, `aria-label`s, focus management on open/close).
- **AC:** **No `innerHTML`/`outerHTML`/`insertAdjacentHTML` with any value derived from `weekData`** (branch labels, counts rendered next to labels). Build via `createElementNS`/`createElement` + `textContent`. Static-only `innerHTML` (icon sprites) permitted.

---

## 3. Commands

```sh
npm install       # once
npm test          # vitest — run for any data-logic change (stat aggregation helpers)
npm run validate  # html-validate — must pass before commit
npm run screenshots && npm run hero:svg   # only if regenerating canonical screenshots
```
- Manual verification in browser is the primary gate (open `zenit-week.html` directly): open panel from summary box, both themes, desktop + mobile widths, 3 and 8 branches, empty week, week with/without unplanned tasks.

---

## 4. Project Structure (within the single file)

All in `zenit-week.html` — **single-file policy, never split.**
- **CSS:** new rules in the existing `<style>` in `<head>`; kebab-case ids/classes; Flexbox; reuse `.agenda-action-btn` for any button (no new orphan button classes per project rule); responsive via `@media`.
- **Icons:** if a stats/chart icon is needed, add a new `<symbol>` to the inline SVG sprite sheet (~line 2993+), referenced via `<use href="#icon-…">`.
- **Markup:** new panel container + backdrop following the established panel pattern (e.g. `is-open` class toggling as used by Quick-add at ~line 13336); placed near the other floating panels.
- **JS:**
  - New render entry `renderStatsPanel()` + `openStatsPanel()` / `closeStatsPanel()`.
  - **Reuse, don't duplicate:** `findNode`, `getPriorityWeight`, the leaf-detection predicate, and the baseline color logic currently inside `updateSummary()` (line ~9716). If the weighted-stats and leaf logic are locked inside `updateSummary`, **extract a shared pure helper** (e.g. `computeWeekStats()` returning `{ counts, weighted, perBranch }`) that both `updateSummary()` and the panel call — so the top box and panel can never disagree. This refactor is in-scope and must keep `updateSummary` output identical.
  - Counts aggregation (planned/unplanned × done/open, per branch + global) lives in that shared helper so it's unit-testable.
  - Hook the panel into existing `Esc`/close handling and re-render on data change while open.

---

## 5. Code Style
- `'use strict';`, `const`/`let`, camelCase, no `var`.
- SVG elements via `document.createElementNS('http://www.w3.org/2000/svg', tag)`.
- No browser-native `confirm`/`alert`/`prompt`; use `showAppConfirm(...)` if any confirmation is ever needed (not expected here).
- Match surrounding code's comment density and idioms; keep the diff surgical — touch only what the feature needs (the `updateSummary` helper extraction is the one sanctioned adjacent refactor, justified by anti-duplication).
- Prefer surgical DOM updates; full re-render of the panel on open is fine (it's not on the hot path).

## 6. Testing Strategy
- **Unit (vitest):** the extracted `computeWeekStats()` (or equivalent) is pure and tested:
  - global + per-branch counts for planned/unplanned × done/open;
  - counter semantics (one task, done iff `val>=max`) in counts; fractional `val/max` in weighted;
  - priority weighting matches existing `updateSummary` expectations (regression: top-box numbers unchanged);
  - edge cases: empty week, branch with no tasks, all-planned week, all-unplanned week, `_editing` nodes excluded.
- **html-validate:** `npm run validate` passes.
- **Manual:** the F7/F8 matrix (themes × widths × branch counts × empty/unplanned states) and that opening/closing creates no undo entry and no `weekData` mutation.

## 7. Boundaries

**Always:**
- Keep everything in `zenit-week.html`.
- Reuse existing helpers/tokens/buttons; extract a shared stats helper rather than copy weighting math.
- Add EN + CZ strings via `t()`; full light/dark + responsive.
- DOM-construct anything touching `weekData` data — never `innerHTML` with user-derived strings.
- After implementation: give a one-line commit message and ask "Should I add and commit?" (per project workflow). Work stays on `feature/stats-panel`.

**Ask first:**
- Any change to the `weekData` shape or persisted format (spec assumes none).
- Adding a dependency or build step.
- Removing/changing the top box's existing semantics beyond making it the panel trigger.
- Promoting the timeline (F5) into the first merge vs. shipping it as a fast-follow.

**Never:**
- Introduce a plan-snapshot / frozen-baseline data model (explicitly out of scope).
- Add cross-week/historical analytics, export/share, or editing from the panel.
- Use browser-native dialogs.
- Create orphan button classes or hard-code colors/strings.
- Split the app into multiple files.

---

## Resolved decisions (locked)
- Layered all-three story; **new dedicated panel**; **donut + branch-tinted stacked bars**; live `unplanned` flag (no snapshot).
- **Entry:** clicking the existing summary box opens the panel.
- **Donut center:** overall completion %.
- **Metrics:** priority-weighted throughout ①②③ (revised post-T1; donut centre matches the summary box). Originally mixed counts/weighted — changed per user decision.
- **Timeline ④:** desktop-only, fast-follow (may merge after F1–F4).
- **Mobile:** donut + headlines + ratio-bar; compact ②; hide ④.

## Open (settle during build, no user blocker)
- Partially-ticked counter in count-based sections: default "one task, done iff at max" — confirm reads right visually.
- Unplanned shading: hatch `<pattern>` vs reduced-opacity overlay — pick whichever stays clean in dark mode at 8 hues.

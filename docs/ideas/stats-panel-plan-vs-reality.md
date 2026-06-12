# Stats Panel — Plan vs Reality

## Problem Statement
How might we let a user see, at a glance, how their actual week diverged from the Monday plan — what got done, what slipped, and how much unplanned work crashed in — in a panel that looks professional and is instantly understandable?

## Context (current state)
- Today's stats live in a small expandable box pinned to the top of the map (`#placeholder-panel`, rendered by `updateSummary()` at `zenit-week.html:9716`).
- Collapsed: global `done (%) / total` with an effort-load color (baseline / stretch / overload).
- Expanded: per-branch `done (%) / total` rows + a stacked **ratio-bar** of each branch's share of total load.
- All current numbers are **priority-weighted** (critical 2×, high 1.5×, normal 1×; counters count `val/max × weight`).
- `unplanned` is a **manual boolean flag** (U key) with an `unplannedAt` timestamp. `doneAt` and counter `ticks[]` give per-day completion data. **There is no frozen snapshot of "the plan."**

## Recommended Direction
Build a **new dedicated Stats panel** (a drawer/modal opened from the toolbar, sibling to the Todo and Daily-log panels). Keep the existing tiny top box as the always-on glanceable summary — the new panel is the "lean back and reflect" surface, opened deliberately.

The panel tells **one layered story top-to-bottom**, each section answering a distinct question, using hand-built SVG charts for a professional look:

1. **Plan vs Reality** (hero) — a donut split into four arcs: planned-done / planned-open / unplanned-done / unplanned-open, center showing global completion %. Beside it, three headline metrics: *Plan completion*, *Unplanned load* (share of tasks that were unplanned), *Unplanned completion*. **By task count** — this is the intuitive narrative metric. The donut is **global**, not per-branch, so it stays stable and readable at any branch count (3 to 8+).
2. **Follow-through** — one horizontal **stacked bar per branch**, segmented plan-done / plan-open / unplanned-done / unplanned-open. Each bar is **tinted with its own branch color**, using shade/opacity for status (done = solid, open = faded, unplanned = hatched). This keeps branch identity *and* status in one bar and scales cleanly to 8 branch hues — avoiding a shared 4-color status legend that would fight with branch colors. Bars stack vertically and scroll, so high branch counts degrade gracefully.
3. **Effort & Balance** — reuse the existing **ratio-bar** + baseline gauge (load vs baseline / stretch / overload). **Priority-weighted load**, matching the top box's semantics — answers "was I overloaded / balanced." Already handles N branches (segment labels hidden under 10%).
4. **The Week** (**desktop-only**, fast-follow — not MVP-blocking) — a Mon→Sun timeline from `doneAt` / `ticks` / `unplannedAt` showing when work got done and when unplanned tasks appeared. The most novel insight, but the hardest to make visually clean; hidden entirely on mobile.

Why this shape: it directly serves the stated need (see the plan, see what crashed in), reuses proven weighting + day-key logic, and requires **no new data model** (live `unplanned` flag, per the decision). The two genuinely new insights — the planned×done cross-tab and the timeline — are what differentiate it from the current box.

### Responsive behavior (desktop rich, mobile lean)
Mobile has far less space, so it shows the *story* and hides the *detail* — same DOM, CSS breakpoints only (consistent with the app's existing `@media` patterns), no separate mobile codepath:

| Section | Desktop | Mobile |
|---|---|---|
| ① Plan-vs-Reality donut + 3 headlines | full | **kept — the core** |
| ② Per-branch stacked bars | full | compact (bar + counts, no inline labels) |
| ③ Balance: ratio-bar + baseline | full | kept (already compact) |
| ④ Mon→Sun timeline | shown | **hidden** |

Mobile = donut + headlines + ratio-bar: the whole "how was my week" answer in one thumb-scroll.

### Branch-count scaling (3 normal, 4–8 possible)
Variable branch count mostly *validates* the design rather than stressing it: the hero donut (①) is global and unaffected; the ratio-bar (③) already handles N branches; the per-branch bars (②) stack vertically and scroll. The only adaptation needed was the per-branch bar coloring — solved by branch-tinting (above), which scales to 8 hues cleanly.

**Mixed metrics by design:** narrative sections (1, 2) use **task counts** because "9 of 34 tasks were unplanned" is how a person thinks about their week; the balance section (3) uses the **priority-weighted load** because overload is about effort, not task count. This is deliberate, not an inconsistency — but it's the #1 thing to confirm before building.

**Branch:** this is a larger, multi-section change (charts + responsive + i18n + theming) and will be built on a dedicated **`feature/stats-panel`** branch cut from `main` — no work on `main`.

## Key Assumptions to Validate
- [ ] **Counts for narrative, weighted for balance is the right split.** Test: mock the panel with real week data; check whether the count-based headline reads true to the user's felt experience of the week. (If they expect weighted everywhere, collapse to one metric.)
- [ ] **A hand-built SVG donut + branch-tinted stacked bars reads as "professional," not "homemade."** Test: build section 1 only, view in light + dark, on desktop + mobile width, before committing to sections 2–4.
- [ ] **Counter nodes split cleanly into done/open** (done = `val`, open = `max − val`) and that fractional segments look right in a stacked bar.
- [ ] **Branch-tinting reads clearly across statuses** — done/open/unplanned distinguishable within one branch hue, in both themes, at 8 branches. Test during the section-2 visual pass.

> Note: unplanned-flag diligence is **not** a risk — flagging is entirely the user's call. A week with no unplanned tasks is a valid, positive outcome (see empty state), not a data gap.

## MVP Scope
**In:**
- New toolbar button + Stats panel scaffold (follow the Daily-log / Todo panel pattern; reuse `.agenda-action-btn` per the button-reuse rule).
- Section 1 (Plan vs Reality donut + 3 headline metrics).
- Section 2 (per-branch stacked bars).
- Section 3 (reuse existing ratio-bar + baseline gauge logic).
- **Responsive behavior** per the table above: mobile keeps ① + headlines + ③ ratio-bar, compacts ②, hides ④ — CSS breakpoints only.
- **Empty / positive state**: a week with no unplanned tasks renders as a clean positive signal ("No unplanned tasks this week 👍"), not a warning — flagging is the user's choice.
- Full light/dark theming, i18n (EN + CZ `t()` keys), no `innerHTML` with user data, custom dialogs only, reuse `.agenda-action-btn`.
- Built on a `feature/stats-panel` branch.

**Out (this iteration):**
- Section 4 timeline (desktop-only fast-follow once 1–3 land and read well).
- Any data-model change.

## Not Doing (and Why)
- **Frozen plan snapshot / "Lock plan" action** — explicitly decided out. True "appeared after I planned" detection needs a new data model + Drive-sync merge handling. The live `unplanned` flag ships now; revisit only if diligence proves too low.
- **Cross-week / historical trends** — multi-week analytics is a separate, larger feature. This panel is about *one* week's plan vs reality.
- **Export / share / print stats** — no evidence it's needed; adds surface area.
- **Editing tasks from the stats panel** — keep it a read-only reflection surface; editing lives on the map.
- **Replacing the top summary box** — it's a good glanceable summary; the panel complements it rather than competing.

## Resolved Decisions
- Layered all-three story; new dedicated panel; donut + stacked bars; live `unplanned` flag (no snapshot).
- **Metrics: priority-weighted throughout** (①②③). Initially mixed (counts for ①②, weighted for ③); reversed after build when the donut % (counts) diverged from the weighted summary box. Now one consistent lens — donut centre matches the box.
- Per-branch bars **branch-tinted** with status via shade/opacity (done solid, open faded, unplanned hatched).
- Timeline (④) is **desktop-only**, fast-follow.
- Mobile shows donut + headlines + ratio-bar only.
- Built on `feature/stats-panel`.

## Open Questions
- Counts vs. weighted: confirm the mixed-metric split above, or pick one lens throughout? (Last metric call before spec.)
- Should the donut center show global completion %, or the more on-narrative "unplanned share"?
- Toolbar real estate: is there room for another button, or should Stats live behind an existing menu/overflow?

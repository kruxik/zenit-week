# Root 3-Brick Week Navigation

## Problem Statement
How might we make previous/next-week navigation immediately obvious on the root node, without sacrificing canvas space or breaking the radial layout?

## Recommended Direction
Replace the current circular caret buttons that straddle the center node's top/bottom edges (zenit-week.html:7582-7608) with a **3-brick attached stack**:

- **Top brick** — 50% root height, up-arrow + "Previous" / "Předchozí", click = prev week
- **Middle brick** — 100% root height, week label (unchanged), keeps gear + `+Branch` buttons
- **Bottom brick** — 50% root height, down-arrow + "Next" / "Další", click = next week

The three bricks share borders (no gap) and the exact width of the week brick — one fused unit. When the brick's direction leads toward the current week, the **whole brick fills amber** (`#E8A020`, preserving today-direction hint from current design). Whole brick is a click target = ±1 week navigation.

This wins on discoverability (the current carets are visually tied to the node edge and read as decoration rather than buttons) while staying within the existing SVG node rendering model. MVP keeps scope minimal — defer richer affordances (target-week preview labels, scrubber dots) to a follow-up.

## Key Assumptions to Validate
- [ ] **Center bbox growth (2× tall) won't collide with first-row radial branches.** Check `computeLayout` — does it read `getNodeSize('center')` for the root, or use a fixed height? If fixed, branches near top/bottom may overlap the new bricks.
- [ ] **"Předchozí" + arrow fits at 50% root height.** At default font (~16-18px) brick is ~35-45px tall. Width is ~200-260px. Should fit; verify at min zoom and with shortest week labels.
- [ ] **Drag-to-pan still works on bricks** OR is intentionally disabled. Currently the center node is draggable; new brick click handlers must not break or steal pan/drag.
- [ ] **Amber fill doesn't clash with adjacent branch node colors** (esp. Family `#A259FF`, Work `#F24E1E`).

## MVP Scope
**In:**
- 3-brick attached SVG stack inside the `isCenter` branch of `makeNodeGroup` (zenit-week.html:7566+)
- Replace existing `week-nav-btn` circles with full-width brick rectangles
- Preserve current behavior: click prev = `offsetWeek(currentWeekKey, -1)`, click next = `+1`
- Preserve amber today-direction fill on the brick whose direction points toward `todayWeekKey()`
- i18n: reuse existing `toolbar.prevWeek` / `toolbar.nextWeek` translation keys (already EN + CS)
- Middle brick keeps gear (top-right) and `+Branch` buttons (left/right edges) unchanged

**Out (for MVP):**
- Target-week preview labels ("← W19")
- Long-press / right-click week picker
- Keyboard shortcut bindings for ±1 week
- Scrubber / week-range dots

## Not Doing (and Why)
- **Horizontal ribbon (bricks left/right of week node)** — conflicts with existing `+Branch` buttons on the center node's left/right edges. Moving `+Branch` would be a larger refactor with no clear UX win.
- **Single-bar split bottom (V5)** — breaks the "3 bricks" mental model and feels like browser back/forward rather than a timeline.
- **Target-week label preview in bricks (V2/V7)** — genuinely better UX, but pushes brick height past the 50% spec and adds rendering cost. Defer to a v2 once the geometry settles.
- **Scrubber / multi-week jump UI (V6)** — adds visual chrome that competes with branches. Solve discoverability first; jumping is a separate problem.
- **Removing today-direction amber hint** — explicit text labels could replace it, but the amber cue is cheap, already implemented, and visually distinct from text scanning. Keep.
- **Move gear icon to toolbar** — orthogonal to nav redesign; touching it widens scope.

## Open Questions
- Does `computeLayout` need explicit awareness of the taller center bbox, or does its existing `getNodeSize('center')` lookup already handle this once we report the new height?
- Should the prev/next bricks still be draggable as part of the center node, or should they be excluded from drag (treat as pure buttons)?
- Should brick borders match the week brick's gradient (`url(#node-grad-center)`) or use a neutral fill so the amber state pops more?
- At very small zoom levels, do we want a fallback (e.g. icon-only) when text would clip?

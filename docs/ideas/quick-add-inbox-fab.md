# Quick Add — Mobile Inbox FAB

## Problem Statement
How might we let mobile users capture activities in under 3 seconds without navigating the mindmap — so friction never causes an idea to be lost?

## Recommended Direction

A floating "+" FAB replaces the current Help button (bottom-right). Tapping it opens a slide-up input drawer above the keyboard with immediate cursor focus. User types a label, optionally appends `#prefix` to route it to a branch. Submitting closes the drawer and keyboard.

Items created this way become **inbox nodes** — marked with `inbox: true` flag, rendered below their assigned branch node (or below the center node if unassigned) without a bezier connection, in a muted visual style. They appear as the last item in the existing "Any Day" group in the daily/todo panels. User drags them to a permanent home later — existing drag system, no new behavior needed.

## Key Assumptions to Validate
- [ ] `inbox: true` flag needed on node so `validateAndRepair()` doesn't garbage-collect parentless-looking nodes — verify current repair logic
- [ ] Layout engine can skip inbox nodes in recursive pass and place them in a dedicated post-layout pass below their parent/center — needs audit of `computeLayout()`
- [ ] Mobile browser keyboard reliably triggers on programmatic `.focus()` — test on iOS Safari and Android Chrome

## MVP Scope

**In:**
- "+" FAB bottom-right, replaces `#help-fab`; Help item added as last entry in Settings menu
- Slide-up input drawer — CSS `transform` animation (`transition: transform 0.25s ease`)
- `#branch` autocomplete: types more chars to narrow collision; reads live `weekData.nodes` where `type === 'branch'`; updates whenever branches change
- Node creation: `inbox: true`, `parent: branchId || 'center'`, no bezier, muted branch color (or gray if unassigned), placed below parent node in layout post-pass
- Appears in "Any Day" as last item (same as any unscheduled activity)
- Dragging inbox node to a real parent clears `inbox` flag — existing drag handles it

**Out:**
- Batch/multi-add mode
- Counter node (`Nx`) creation via quick-add
- Unplanned auto-flag
- Day scheduling from quick-add
- Any new drag system behavior

## Not Doing (and Why)
- **Auto-mark Unplanned** — quick-adds are often planned, just not yet placed on the map
- **Batch mode** — uncommon scenario; single-add covers the core use case
- **New drag behavior** — existing reparenting drag covers the "place it later" step
- **Bezier connection** — the absence of a line is the visual signal: "this node needs a home"

## Open Questions
- **Inbox node color**: Full branch color vs muted (40% opacity/desaturated)? Muted communicates "needs placement" while still showing branch affinity — recommended.
- **Unassigned nodes near center**: Above or below? Below keeps center label unobscured — but depends on how many unassigned nodes accumulate.
- **`#` autocomplete UX in the input**: Inline suggestions appear as pills above the text field? Or a dropdown? Needs decision before implementation.

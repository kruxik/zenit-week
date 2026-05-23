# Agenda Full-Path Reveal

## Problem Statement
How might we disambiguate similarly-named agenda items by exposing each item's full ancestor path on demand, without cluttering the resting row?

## Recommended Direction
Tap the agenda item label to toggle in-place between the resting `parent · label` form and the full ancestor chain (root branch excluded only as the literal center node; all real branches and intermediate activities shown). No popup, no layout shift, no second gesture path. The label morphs, the row height stays constant, and overflow truncates ancestors from the start with a leading ellipsis so the leaf label always remains visible.

A small `…` affordance is shown between prefix and main whenever the chain would reveal new information beyond what's already visible (branch via dot + immediate parent via prefix) — i.e. when there is at least one ancestor between the branch and the immediate parent. The affordance both signals the gesture and gates rendering cost: rows that wouldn't reveal anything new get no toggle.

State is ephemeral — re-renders, swipe actions, navigation away, and tab switches all reset every row to collapsed. No persistence, no per-week setting, no localStorage write.

## Key Assumptions to Validate
- [ ] A meaningful fraction of real-week items have ≥1 ancestor beyond branch + immediate parent — otherwise the affordance is dormant. Validate: scan current and recent week data; count nodes where ancestor chain length > 2.
- [ ] Tap on `.daily-log-label` does not collide with existing agenda gestures (swipe-left action, swipe-right action, drag-reorder, long-press, context menu). Validate: read `addSwipeGesture` and the row's listeners; confirm a pure tap-with-no-movement is currently unhandled.
- [ ] CSS `direction: rtl` + `dir="ltr"` inner wrap reliably produces start-truncation with leading ellipsis across Chromium/WebKit/Firefox. Validate: prototype in a sandbox row.
- [ ] The `…` glyph reads as "expandable" rather than "loading" or "more menu". Validate: show to one or two users without prompting.

## MVP Scope

**In:**
- New helper `getAgendaAncestorChain(node)` returning ordered ancestors from branch → immediate-parent (exclude center; include branch label).
- In `buildAgendaItem`, when chain length > 2, attach a click handler on `.daily-log-label` that toggles `data-expanded` on the label element.
- Expanded state renders chain joined by ` › ` with start-truncation via CSS trick.
- Resting state unchanged: existing `prefix · main` layout untouched.
- `…` affordance glyph appended between prefix and main when chain qualifies.
- Click bubbles stop at the label so it doesn't trigger row-level handlers.

**Out:**
- Counter rows and per-tick log rows — same toggle works because they pass through `buildAgendaItem` already; no special case.
- Day hint stays where it is (suffix on main); chain does not absorb it.

## Not Doing (and Why)
- **Popup / floating tooltip / bottom sheet** — adds z-index, animation, dismissal logic, and platform forks. In-place toggle solves the stated need.
- **Clickable segments → jump to mindmap or filter Agenda** — couples Agenda to mindmap navigation or introduces a new filter UX. Stated need is "clue", not "navigate".
- **Persistent expanded state across renders / weeks** — adds storage, sync (Drive), and merge conflict surface for an ephemeral UI affordance.
- **Auto-expand on duplicate-label detection** — needs collision-scan, adds inconsistent UI ("why is this row expanded?"). User-controlled toggle covers the same case.
- **Per-segment branch dot / priority icon** — visual weight not justified by the disambiguation goal.
- **Press-and-hold variant on desktop** — discoverability and read-while-pressed both fail; rejected in Phase 2.

## Open Questions
- Should the affordance threshold be chain length > 2 (skip when only branch + immediate parent) or always-on whenever chain length > 1? Default: > 2; reconsider after seeing it on real data.
- Should swipe-action triggers (mark done, etc.) collapse the row before animating, or animate the expanded label? Default: collapse on any structural state change via the natural re-render path.
- Day-leaf (`dayChild`) rows: include the synthetic day-leaf segment in the chain, or treat the day-parent as the leaf? Default: treat the day-parent as the leaf — chain matches what the user mentally owns.

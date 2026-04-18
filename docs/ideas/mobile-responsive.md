# Mobile Responsive

## Problem Statement
How Might We let users review and interact with their week plan on a phone, keeping the SVG mind map as the core visual, without breaking the desktop experience?

**Current state:** The app has zero touch support for the SVG canvas. No pinch-zoom, no tap-to-select, no long-press context menu. Hover states don't exist on touch. The toolbar is designed for mouse precision.

## Recommended Direction

Build in two focused layers:

**Layer 1 — Baseline (must-have, ~2–3 hours):**
- Add `<meta name="viewport" content="width=device-width, initial-scale=1">` — currently missing, this alone breaks mobile layout
- Switch **all** mouse events to **Pointer Events** (`pointerdown/pointermove/pointerup`) — full migration including SVG canvas, color picker canvas, and zoom slider; same feel regardless of input type; `setPointerCapture` replaces the awkward global mousemove pattern
- Gate node drag with `e.pointerType === 'touch'` check inside the shared handler (Option A) — one handler, no parallel event systems
- Add pinch-to-zoom (two-pointer distance delta → calls existing `zoomAt()`)
- Responsive toolbar: compress week-nav label to narrow format on small screens; hide logo text if needed

**Layer 2 — Action model (~3–4 hours):**
- Tap on `activity` or `counter` node → **floating action bar** at bottom of screen (Done toggle, Counter +1/−1, Priority cycle). No long-press needed, no context menu on mobile.
- Tap on `branch` or `center` node → no action bar (these are structural, not actionable)
- Tap elsewhere → dismiss action bar
- Disable node drag on touch (navigation only)
- Counter inline SVG buttons: evaluate on real device first — if tap target is too small, surface +/− in action bar

## Key Assumptions to Validate
- [ ] Radial map is readable at phone zoom on a typical week's worth of nodes — test manually before building interactions
- [ ] Pointer Events API works reliably across iOS Safari and Android Chrome for the app's drag/pan pattern
- [ ] Floating action bar covers the "review + check off" use case without needing the full context menu

## MVP Scope
Layer 1 first: viewport meta + Pointer Events migration + pinch-zoom + responsive toolbar. Ship and test on real device before Layer 2.

Layer 2 adds the floating action bar for node interaction on touch.

**In:** pan, zoom, tap-to-act, done toggle, counter increment, priority change, responsive toolbar
**Out:** node drag on mobile, inline rename on mobile, full context menu on mobile

## Not Doing (and Why)
- **Long-press context menu** — floating action bar on tap is more reliable (iOS/Android fire `contextmenu` inconsistently) and better UX
- **Node drag/repositioning on mobile** — wrong use case for "review + check off", massive complexity for minimal gain
- **Inline text editing on mobile** — keyboard popup breaks SVG input placement; not needed for review use case
- **Separate mobile page/route** — one adapted UI is less maintenance than two parallel UIs

## Implementation Decisions
- **Pointer Events scope**: full migration (SVG canvas + color picker + zoom slider) — uniform feel across input types
- **Drag gating**: `e.pointerType === 'touch'` check inside the shared `pointerdown` handler, no parallel event paths
- **Branch node tap**: no action bar — branch/center nodes are structural, not actionable
- **Counter inline buttons**: test on real device; expand to action bar only if tap target proves too small

## Open Questions
- Is the radial map actually readable at 375px viewport with a full week of nodes? Test this first.
- Should the floating action bar eventually replace the desktop context menu too, or coexist?
- Which toolbar actions are essential on mobile vs. can be hidden?
- Are counter inline SVG `+`/`−` buttons large enough to tap accurately on mobile?

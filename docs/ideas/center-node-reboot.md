# Center Node Reboot: Identity In, Chrome Out

> Supersedes [root-3-brick-nav.md](root-3-brick-nav.md). That design made week
> navigation *visible* by growing the center node to three bricks; this one
> concludes the bricks were the wrong place to begin with — global chrome does
> not belong in a pannable, zoomable coordinate space.

## Problem Statement
How might we make week navigation reachable without panning and zooming to find
it — and give the mind-map's center a job worth its pixels?

## Recommended Direction
Chrome does not belong in canvas space. Today the center node holds four
unrelated jobs — week label, prev/next week, week-actions gear, pan handle — and
three of them are global controls trapped in a zoomable, pannable coordinate
system. Evict all three to a fixed DOM bar directly under the toolbar, at
`top:68px`, the slot the day-filter chip vacates.

What remains in the center becomes an identity anchor rather than metadata — and
it stops being a pill. The root is a **circle**, so the completion ring around it
is a true ring rather than a racetrack. Inside it, in order of what is available:

1. the signed-in user's Google profile photo,
2. their initials on the colour the toolbar avatar already derives, when the
   account has no photo (or the photo cannot be fetched),
3. `Me` / `Já` when signed out.

Around that sits a completion ring driven by the existing priority-weighted
`computeWeekStats().global.percent` — the same number the Stats donut shows. The
ring is drawn **inside** the circle's edge, so the branch edges that meet the
root at its left and right extremities do not cross it. Dragging still pans; a
click with no drag opens Stats. The `+ Branch` buttons on the left and right
edges stay.

The first name is no longer painted, but it is still derived: it becomes the
root's accessible name and hover title, so an image-only node is not a blank to
a screen reader.

The week bar reads `‹  Week 34 (Aug 17 – Aug 23)  ⋯  ›`. Arrows keep the
today-direction accent. The label itself is a button: click to jump to the
current week, tinted when you are away from it. The `⋯` opens today's center
context menu (Current Week / Transfer Unfinished / Transfer Reusable / Set
Baseline / Clear Week) — deliberately **not** a gear, since a gear already means
*app settings* in the bottom-right FAB pill.

The day-filter chip relocates to `bottom:62px`, directly above the bottom nav
and beside the day-filter cell that spawns it. When the view-level row
discloses, the chip and `#view-level-toast` shift up by the row's height.

## Key Assumptions to Validate
- [ ] "Week 34 (Aug 17 – Aug 23)" + 2 arrows + `⋯` fits a 320px viewport in both
      EN and CS — measure; if not, the date range gets a short form the way
      `#day-filter-chip-empty-short` already does
- [ ] The ring stays correct after a surgical update — toggle a task done via `D`
      and confirm the percentage moves without a full render
- [ ] Keeping or shrinking `CENTER_W` does not disturb `computeLayout`'s
      `baseDistance` / branch placement — `layout.test.js` must stay green
- [ ] Drive `displayName` reliably yields a usable first name for signed-in
      accounts (verify against the stored `zenit-week-google-auth` payload)
- [ ] Removing `.center-outer-pill` does not break reset-view / zoom-to-fit bbox
      math — `reset-view.test.js`, `zoom.test.js`

## MVP Scope
**In:**
- `#week-bar` — arrows, label-as-today-button, `⋯` week-actions trigger
- Center node = first name + completion ring; nav bricks, gear and outer pill
  removed from the `isCenter` branch of `makeNodeGroup`
- Chip relocation with view-level-row stacking
- i18n keys for EN + CS
- `scripts/og-image.mjs` strip-list update (it removes `.week-nav-btn` and
  `.gear-btn`, which will no longer exist)
- Regenerated screenshots (`npm run screenshots`, `npm run hero:svg`)

**Out:** everything in Not Doing.

## Not Doing (and Why)
- **Editable / stored center name** — read-only derivation adds no persisted
  state, no Drive file, no CRDT merge path.
- ~~**Avatar photo in the center**~~ — **reversed 2026-08-17 by the author.** The
  original objection was that a photo turns a mind-map root into a profile card.
  Going circular and dropping the name text answers it: the result reads as a
  hub, not a card. The app's meta CSP already permits `*.googleusercontent.com`,
  so nothing had to be widened.
- **Week nav inside the toolbar's empty middle** — better pixel budget on
  desktop, but does not fit 320px, so it costs two layouts.
- **Swipe / bracket-key week navigation** — collides with `branchSwipeStart`.
  NEXT candidate.
- **Moving app settings out of the FAB pill** — unrelated to this problem.

## Resolved Questions
- **`⋯` menu** — reuses `showContextMenu('center')` verbatim, anchored to the
  button's rect. No new dropdown. *(Shipped in S2a.)*
- **`ctx-current-week`** — deleted. The week label button in the bar does the same
  job where people can actually see it.
- **Ring on an empty week** — renders as a full track with no filled arc, so the
  root keeps exactly the same size and silhouette whether or not the week has
  content.
- **Click the root** — opens the Stats panel. Drag still pans.
- **Signed-out wording** — `Me` / `Já`, not `You` / `Ty`. The root is the user's
  own node in their own map; second person made it sound like the app talking
  about someone else.

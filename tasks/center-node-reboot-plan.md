# Plan — Center Node Reboot: Identity In, Chrome Out

Source idea: [`docs/ideas/center-node-reboot.md`](../docs/ideas/center-node-reboot.md)
Supersedes: [`docs/ideas/root-3-brick-nav.md`](../docs/ideas/root-3-brick-nav.md)
Task list: `tasks/center-node-reboot-todo.md` · Single file: `zenit-week.html`

## Overview
Evict global chrome from canvas space. The week label, prev/next week buttons and
week-actions gear leave the SVG center node for a fixed DOM bar under the toolbar.
What stays in the center becomes an identity anchor: the user's first name wrapped
in a completion ring traced on the pill's own outline. The day-filter chip vacates
`top:68px` (the bar's new home) and relocates above the bottom nav.

## Principles
- **Vertical slices.** Each slice delivers one complete path and leaves the app
  working. Slice 2a intentionally leaves week nav available in *both* places for
  one task so each half is independently verifiable.
- **Single-file policy.** All app code in `zenit-week.html`. Only `scripts/og-image.mjs` is separate.
- **Each slice ships with:** code + EN/CS i18n (where user-visible) + vitest
  coverage for anything pure. `npm test` and `npm run validate` green before commit.
- **No new persisted state.** No localStorage key, no Drive file, no CRDT path.

## Architecture Decisions

**AD1 — The week bar lives inside `#canvas-container`, not `<body>`.**
`#day-filter-chip` is already `position:absolute` inside the canvas container; the
bar takes the same slot and the same containing block. This buys hide-in-agenda for
free: `.app-panel` is `z-index:2000` and full-viewport on mobile, so a canvas-scoped
bar is covered exactly the way the center node is today. Week navigation from the
agenda view stays out of scope — it does not exist today either.

**AD2 — The ring is the pill's own outline, not a separate donut.**
Draw a rounded-rect outline `<path>` matching the center rect's geometry and set
`stroke-dasharray` from the percentage. Starts at top-center, fills clockwise.
- *Rejected:* `pathLength` on `<rect>` — cleaner, but Safari support is unverified.
- *Rejected:* a small `_statsDonut`-style circle inside the pill — adds width to a
  node whose width feeds layout, and duplicates the Stats panel visual.
- *Rejected:* making the root circular — a true ring, but changes `CENTER_W` (see AD3).

**AD3 — ~~`CENTER_W` / `CENTER_H` stay at 240×80.~~ Superseded 2026-08-17: the root
becomes a 160×160 circle.**
The original caution was that `computeLayout` reads
`positions['center'] = {w: CENTER_W, h: CENTER_H}` and derives branch `baseDistance`
from it, so changing either risked re-baselining three test files. On inspection the
risk was overstated: `layout.test.js` asserts only *relative* positions
(`d1.x === d2.x`, zig-zag vStep), and neither `reset-view.test.js` nor
`zoom.test.js` references the center's size at all. Going circular costs no test
churn. Branch edges also land better: a circle's left and right extremities are
exactly `(±r, 0)`, which is precisely where `drawEdges` already starts them —
truer than it ever was for a pill.

**AD8 — The root shows the user, in three tiers, and the ring goes *inside* it.**
Photo → initials → `Me`/`Já`, mirroring what the toolbar avatar already resolves.
Rather than duplicating that decision, the photo-vs-initials test is extracted from
`showSignedInAvatar` into one predicate both callers share. The initials layer is
drawn *underneath* the photo instead of behind an `onerror` handler: if the image
fails or is never requested, the initials simply show through. No error plumbing in
a subtree that gets rebuilt on every render.
The ring is inset inside the circle's edge, not wrapped around the outside. Outside,
its leftmost and rightmost points sit exactly where the branch edges run, and every
edge would visibly cross it.

**AD4 — Ring is drawn at build time and patched in `updateSummary()`.**
`updateNodeUI()` cannot carry it: it calls `findNode(nodeId)`, which returns `null`
for the virtual `center`, and early-returns. `updateSummary()` is the correct hook —
it already fires from all six mutation paths and its `_computeSummarySignature()`
covers exactly the ring's inputs (`done`, `val`, `max`, `priority`, `branch`,
`unplanned`). Because it early-returns on an unchanged signature, `makeNodeGroup`
must draw the ring correctly itself rather than relying on the patch.

**AD5 — `formatWeekLabel()` becomes single-line.**
It currently returns a `\n`-joined two-line string for SVG text. Both callers change
in this work (`_computeNodeSize`'s center branch and the center render), so the `\n`
has no remaining consumer. The bar wants one line.

**AD6 — The trigger is `☰`, not a gear.**
`#fab-settings` already means *app settings*. A second gear meaning *week actions*
is an ambiguity, not a shortcut. The `☰` reuses `showContextMenu('center')` verbatim,
anchored to the button's bounding rect — no new dropdown code.

**AD7 — The bottom stack gets two shared CSS vars.**
Three fixed elements now compete for the space above the bottom nav
(`#view-level-bar` at 62, `#view-level-toast` at 68/118, and the chip). Rather than a
fourth set of magic offsets, define `--stack-l1` / `--stack-l2` once and have the chip
and toast reference them. Toast steps up over a visible chip via
`body:has(#day-filter-chip.visible)` — a pattern already used for `#quick-add-panel`.

## Dependency graph
```
S1  Pure helpers (centerDisplayName, roundedRectPathD, formatWeekLabel single-line)
     │   no call sites yet → app behaviour unchanged
     ├──> S2a  #week-bar: DOM + CSS + i18n + arrows + today-label + ☰
     │      │   (week nav now exists in two places — both work)
     │      └──> S2b  Strip nav bricks / gear / outer pill from the center node;
     │                 center label → centerDisplayName()
     │                      │
     │                      └──> S3  Completion ring on the center pill
     │
     └──> S4  Day-filter chip → bottom stack   (independent; only shares the vacated slot)
                                    │
S5  og-image strip-list + regenerated screenshots  ←── needs S2b + S3 final visuals
```

## Phases

### Phase 1: Foundation

#### Task 1.1: Pure helpers for name, ring geometry and single-line week label
**Description:** Add three pure functions and make them test-visible. No call sites
change yet except `formatWeekLabel`'s return shape, whose two consumers are rewritten
in S2. `centerDisplayName()` derives the root label: first whitespace token of the
stored Drive `displayName`, else the email local-part, else `t('center.you')`, clamped
to 16 chars. `roundedRectPathD(w, h, rx)` returns a top-center-origin clockwise
rounded-rect path plus its analytic perimeter `2(w-2rx) + 2(h-2rx) + 2πrx`.

**Acceptance criteria:**
- [ ] `centerDisplayName()` returns `Petr` for `displayName: 'Petr Burian'`, the
      local-part for a `displayName`-less signed-in account, and the `You`/`Ty`
      translation when signed out
- [ ] `roundedRectPathD` perimeter matches the analytic formula within 0.5px for
      the center's 240×80 rx=20 geometry, and the path starts at `(0, -h/2)`
- [ ] `formatWeekLabel(2026, 34)` returns one line, no `\n`, in both EN and CS

**Verification:**
- [ ] `npm test -- i18n center` and a new `tests/center-node.test.js` pass
- [ ] `npm test` fully green (formatWeekLabel's shape change breaks nothing else —
      grep confirms only two callers)

**Dependencies:** None
**Files touched:** `zenit-week.html`, `tests/setup.js` (export the three helpers),
`tests/center-node.test.js` (new)
**Estimated scope:** S

### Checkpoint C1
- [ ] `npm test` + `npm run validate` green
- [ ] App visually unchanged apart from a one-line center label

### Phase 2: Chrome eviction

#### Task 2.1: `#week-bar` — arrows, today-label, week-actions
**Description:** New bar inside `#canvas-container` at `top:68px`, centered, styled as
a peer of `#day-filter-chip` (glass background, `--border-subtle`, pill radius). Holds
`‹`, the single-line week label, `☰`, `›`. Arrows call
`loadAndRender(offsetWeek(currentWeekKey, ±1))` and carry the today-direction accent
when that direction leads toward `todayWeekKey()`. The label is a button: click →
`loadAndRender(todayWeekKey())`, accent-tinted while off-current. `☰` opens
`showContextMenu()` for `center` anchored to its own rect. A single `updateWeekBar()`
refreshes label + accents, called from `loadAndRender`, the `hashchange` handler and
`applyTranslations()`.

**Acceptance criteria:**
- [ ] Arrows navigate weeks and the label tracks; the direction toward today is accented
- [ ] Clicking the label from any week lands on the current week and drops the tint
- [ ] `☰` opens the same menu the center gear opens today
- [ ] The whole bar fits a 320px viewport in EN and CS — the date range hides below
      360px, mirroring the `#day-filter-chip-label` pattern
- [ ] Bar is absent in agenda view (mobile) and behind the panel (desktop), with no
      z-index fight

**Verification:**
- [ ] `npm run validate` green (new markup, `data-i18n*` attributes well-formed)
- [ ] `npm test` green
- [ ] Manual: navigate 3 weeks forward and back; switch language mid-navigation and
      confirm the label re-renders; resize to 320px in both languages

**Dependencies:** 1.1
**Files touched:** `zenit-week.html`
**Estimated scope:** M (one file, but four concerns: markup, CSS, wiring, i18n)

#### Task 2.2: Strip nav bricks, gear and outer pill from the center node
**Description:** Delete the `isCenter` chrome from `makeNodeGroup` — the two
`week-nav-btn` brick groups, the `.gear-btn`, and the `.center-outer-pill` rect — plus
their CSS blocks and the two `e.target.closest('.week-nav-btn')` guards in the
`pointerdown` and `click` handlers. The center's label switches from
`formatWeekLabel(...)` to `centerDisplayName()` in both `_computeNodeSize` and the
render path. Right-click / long-press on the center still opens the week menu.

**Acceptance criteria:**
- [ ] The center node renders as a single 240×80 pill with the user's first name,
      `+ Branch` buttons intact on both edges, and dragging still pans the canvas
- [ ] No `.week-nav-btn`, `.gear-btn` or `.center-outer-pill` remains in markup, CSS or JS
- [ ] Right-clicking the center opens the week-actions menu; hovering it and pressing
      `Backspace` still triggers the Clear Week confirm

**Verification:**
- [ ] `npm test` green — `layout.test.js`, `reset-view.test.js`, `zoom.test.js`
      unchanged and passing, proving `CENTER_W`/`CENTER_H` were not disturbed
- [ ] Manual: pan by dragging the center; confirm no dead click zones where the
      bricks used to be

**Dependencies:** 2.1
**Files touched:** `zenit-week.html`
**Estimated scope:** M

### Checkpoint C2
- [ ] `npm test` + `npm run validate` green
- [ ] Week navigation works from the bar with the canvas at any zoom or pan offset —
      the original complaint is resolved and measurable
- [ ] Human review before the ring goes in

### Phase 3: The center earns its pixels

#### Task 3.1: Completion ring on the center pill
**Description:** Draw a `roundedRectPathD` outline over the center rect in two layers —
a full-perimeter track in `--border-soft` and an accent arc whose `stroke-dasharray` is
`percent` of the perimeter, using `computeWeekStats().global.percent` (the same
priority-weighted number the Stats donut shows). Add `updateCenterRing()` and call it
from `updateSummary()` so surgical updates keep it live. Clicking the center (a click
with no drag) opens the Stats panel via the existing `#vtb-stats` path.

**Acceptance criteria:**
- [ ] Ring fills clockwise from top-center and matches the Stats donut's percentage
      exactly, in both themes
- [ ] Marking a task done with `D` moves the ring without a full re-render
- [ ] An empty week shows the track only, no accent arc
- [ ] Click on the center opens Stats; drag still pans and does not open Stats

**Verification:**
- [ ] `npm test` green, including a new case asserting the arc length for a known
      week fixture
- [ ] Manual: toggle several tasks done and watch the ring track the Stats donut
      side by side; confirm on an empty week

**Dependencies:** 2.2
**Files touched:** `zenit-week.html`, `tests/center-node.test.js`
**Estimated scope:** M

#### Task 3.2: Day-filter chip to the bottom stack
**Description:** Move `#day-filter-chip` from `top:68px` to the bottom stack. Introduce
`--stack-l1: 62px` / `--stack-l2: 118px`, point the chip at `l1` and at `l2` under
`html.view-levels-open`, retarget the existing `#view-level-toast` offsets at the same
vars, and step the toast up one level while the chip is visible via
`body:has(#day-filter-chip.visible)`.

**Acceptance criteria:**
- [ ] Chip sits directly above the bottom nav and rises clear when the view-level row
      discloses
- [ ] Chip, view-level row and toast never overlap in any combination of
      open/closed × chip-visible/hidden
- [ ] The vacated `top:68px` slot is occupied only by `#week-bar`

**Verification:**
- [ ] `npm test` + `npm run validate` green
- [ ] Manual: set a day filter, open the view-level row, flip a level to fire the
      toast — all three legible at once, at 320px and desktop

**Dependencies:** None (parallelizable with 2.x and 3.1)
**Files touched:** `zenit-week.html`
**Estimated scope:** S

### Checkpoint C3
- [ ] All acceptance criteria across 2.x and 3.x met
- [ ] Full manual pass in both languages, both themes, phone and desktop widths

### Phase 4: Assets

#### Task 4.1: og-image strip-list and regenerated marketing assets
**Description:** `scripts/og-image.mjs` removes `.gear-btn, .week-nav-btn, .add-btn`
from the center — the first two selectors become dead. Update the selector and comment,
decide whether the ring stays in the marketing image (recommend: strip it; a static
image showing a stranger's completion percentage is noise), then regenerate.

**Acceptance criteria:**
- [ ] `scripts/og-image.mjs` references only selectors that still exist
- [ ] Regenerated `og-image.png` / `og-image-cs.png` show the `My week` / `Můj týden`
      center with no leftover chrome
- [ ] Screenshots and hero reflect the new week bar and center node

**Verification:**
- [ ] `npm run og`, `npm run screenshots`, `npm run hero:svg` all succeed
- [ ] Visual check of every regenerated asset
- [ ] `npm run build` green (no new inline scripts, so `csp-hashes` should be a no-op —
      confirm rather than assume)

**Dependencies:** 2.2, 3.1
**Files touched:** `scripts/og-image.mjs`, `og-image*.png`, `og-image*.svg`,
`screenshot.svg`, `assets/*`
**Estimated scope:** S

### Checkpoint C4 — Complete
- [ ] `npm test`, `npm run validate`, `npm run build` green
- [ ] CHANGELOG entry
- [ ] Ready for review

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Ring goes stale after a surgical update — fails **silently** | High | `updateNodeUI` cannot reach `center` (AD4). Draw in `makeNodeGroup`, patch in `updateSummary`, and make the `D`-toggle case an explicit AC in 3.1 |
| Week bar overflows a 320px viewport, worse in CS | Med | Hide the date range below 360px, exactly as `#day-filter-chip-label` already does; measure both languages |
| Three-way overlap in the bottom stack | Med | Two shared CSS vars + `:has()` toast step-up (AD7); AC 3.2 enumerates all four state combinations |
| Touching `CENTER_W` cascades into `computeLayout` | Low (avoided) | AD3 — constants untouched; the three layout-sensitive test files must stay green *unmodified* as the proof |
| Deleting the bricks leaves dead click zones or breaks pan | Low | Remove both `week-nav-btn` guards in the same task as the bricks; explicit pan AC in 2.2 |
| `displayName` is an unhelpful handle for some accounts | Low | Fallback chain + 16-char clamp in 1.1; no stored override by design |
| og-image degrades quietly (2 center texts → 1) | Low | The script already handles extra texts defensively; regenerate and eyeball in 4.1 |

## Open Questions
1. **`ctx-current-week` after the label becomes a today-button** — keep it in the menu
   for one release as a redundant path, or delete it now? *Recommendation: keep; it
   costs nothing and removal is a separate cleanup.*
2. **Ring on an empty week** — track-only (recommended, and what 3.1 specifies), or
   suppress the ring entirely until the week has content?
3. **Ring in the OG image** — strip (recommended) or keep as a product tell?
4. **Confirm week navigation stays mindmap-only.** AD1 preserves today's behaviour,
   but a DOM bar makes agenda-view week nav nearly free later. Out of scope here.

## Manual verification note
Per `CLAUDE.md`, browser verification has a token budget. Slices 2.1, 3.1 and 3.2 each
need a populated week, a chosen language and a specific panel state. Rather than
seeding data through DevTools, ask for the app to be put in the required state and
then only screenshot/measure to confirm.

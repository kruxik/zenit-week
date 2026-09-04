# Zenit Week - Claude Instructions

## Project Overview
A visually rich, single-file web application for planning weeks using a Mind Map interface. It uses SVG for rendering and `localStorage` for data persistence.

## Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, and JavaScript (ES6+)
- **Graphics**: Inline SVG for mind map visualization, bezier curves for node connections
- **State Management**: In-memory `weekData` object persisted to `localStorage` per ISO week
- **Text Sizing**: Canvas `measureText()` for precise SVG text measurement
- **Icons/Assets**: Native Unicode characters and CSS-based shapes

## Key Files
- `zenit-week.html`: The entire application (HTML, CSS, and JS)
- `sw.js`: Service worker — caches the app shell so launch never blocks on the network

## Architecture

### Data Model
```javascript
weekData = {
  nodes: [
    { id, type, branch, label, parent, children,
      done, unplanned, dropped, priority, reusable, offX, offY, side, _editing,
      // counter nodes only:
      val, max, ticks,       // ticks: ISO timestamp per increment (drives daily log)
      // timestamps:
      doneAt,                // set when marked done
      unplannedAt,           // set when marked unplanned
      droppedAt,             // set when marked dropped
      _ts }                  // epoch ms — Drive merge conflict resolution
  ]
}
```

Node hierarchy:
- **center**: Virtual root (week label)
- **branch**: User-managed categories (default: `work`, `family`, `me`). Can add/delete branches; minimum 1 must remain.
- **activity**: User-created tasks (may have counter children)
- **counter**: Auto-created child when activity label matches `Nx` pattern (e.g., "Pushups 10x"); tracks `val`/`max`

Default branch colors: Work `#F24E1E`, Family `#A259FF`, Me `#1ABCFE` (all customizable via color picker)

`BRANCH_CONFIG` — maps branch id → `{ side: 'left' | 'right' }`, controls radial layout placement

Week key format: `YYYY-WW` (e.g., `2026-14`), stored in localStorage as `zenit-week-2026-14`

### The schedule record

A second record, in the IDB `misc` store under `schedule`, holding dated work that has nothing to do
with this week. It is never part of a week record: writing the schedule never writes a week, and
writing a week never touches the schedule.

```javascript
schedule = {
  entries: [
    { id, label, branch, priority,
      path,            // ['Health', …] — ancestor labels, outermost first, nearest 6 kept
      tree,            // [{ key:'0.1', label, priority?, tick? }, …] — the subtree that travelled
      anchor,          // 'YYYY-MM-DD' — the first occurrence
      repeat,          // { every: N, unit: 'day'|'week'|'month'|'year' } | null
      end,             // { type: 'never' } | { type: 'count', n } | { type: 'until', date }
      plantedThrough,  // 'YYYY-MM-DD' — every occurrence up to here is accounted for
      planted,         // ['YYYY-MM-DD', …] — occurrences materialised ahead of plantedThrough
      _ts }            // epoch ms — Drive merge, same role as on nodes
  ],
  tombstones: [],      // deleted entry ids
  crdtVersion: 0,
}
```

An **entry** is a standing intention; an **occurrence** is what a week receives. Entries never render
on the map. A materialised occurrence is a plain `activity` node with a `dayChild` leaf and two extra
fields, `schedId` and `schedDate` (the real date, which for a swept occurrence is not the day its
leaf sits on). Nothing else marks it — priority, comments, day tags, counters, dropped, transfer,
stats and drag all work on it untouched, because it is not a special kind of node.

The entry carries the **shape** of what was sent, not just its label. `tree` is the subtree below the
sent node, flattened depth-first, each item keyed by its position (`'0.1'` hangs under `'0'`), so the
plant needs no id map. `path` is the ancestor labels it hung under — labels rather than ids, because
the receiving week is a different record. Day children never travel (the date decides the day) and
neither do legacy counters; tick leaves travel as `tick: true` and get their index and label back on
arrival. Subtree nodes get derived ids from `occurrenceTreeNodeId`, so idempotence, two-device
convergence and burial-on-delete all work exactly as they do for the root. Path nodes are keyed on
branch + label chain instead (`occurrencePathNodeId`), so two entries under the same `Health`
converge on one scaffold node; scaffolding is shared and is never buried by a delete. Caps:
`SCHEDULE_TREE_MAX_NODES` 200, `SCHEDULE_TREE_MAX_DEPTH` 6 — over either the send is **refused with a
toast**, never truncated; `SCHEDULE_PATH_MAX` 6 clips instead, because a dropped far ancestor loses
no task, it only re-homes the occurrence one level higher.

### Rendering
- Full `render()` on structural changes
- Surgical `updateNodeUI()` for visual-only updates (avoid full re-render when possible)
- `updateSummary()` for stats panel refresh
- `computeLayout()` calculates radial positions using recursive height and priority-based scaling (critical: 2.0x, high: 1.5x, normal: 1.0x); branches split left/right per `BRANCH_CONFIG`

### Key Functions
- `findNode(id)` — O(1) lookup via `nodeMap` (a `Map<id, node>`, rebuilt on every structural change)
- `genId()` — generates a node ID using `crypto.randomUUID()` with a `crypto.getRandomValues` fallback for plain-HTTP contexts; always call this, never `crypto.randomUUID()` directly
- `getDescendantIds(id)` — recursively collects subtree
- `validateAndRepair()` — garbage collection and orphan cleanup
- `transferUnfinished()` — copies incomplete activity nodes from previous ISO week to current
- `transferReusable()` — copies nodes marked `reusable: true` (with counters reset) to current week
- `nextOccurrence(entry, from)` / `occurrencesInRange(entry, from, to)` / `occurrencesBefore(entry, to, limit)` — pure calendar arithmetic over `'YYYY-MM-DD'` strings. Month and year steps are measured from the anchor every time, so a clamped month never shifts it (31 Jan → 28 Feb → 31 Mar). `occurrencesBefore` lands on the last occurrence by arithmetic rather than enumerating the gap, which is what lets a device a decade behind sweep in one step
- `occurrenceNodeId(schedId, schedDate)` — the only node id in the app that does not come from `genId()`, and shaped exactly like one. Every idempotence property rests on it: an occurrence is planted only when this id is absent from **both** `nodes` and `tombstones` of that week record, which is what makes a reopen plant nothing, two devices converge on one node, and a deleted occurrence never return
- `openWeekIntoView(wk)` — the single week-open path. `loadAndRender` (arrows, week bar, boot) and the `hashchange` handler both route through it, so materialisation hooks one place. Takes the week lock, which is **not** re-entrant
- `materialiseWeek(wk, data)` — plants due occurrences; on the current week it also runs `sweepPastDue`. Takes **no** undo snapshot — materialisation is delivery, not a user edit. Returns whether it planted; a sweep can advance the cursor without planting, so `_scheduleDirty` decides the schedule write separately
- `sendNodeToDate(nodeId, opts)` / `updateScheduleEntry(id, opts)` / `deleteOccurrence(id, date)` / `deleteScheduleSeries(id)` — the four writes. Deleting a single occurrence writes the tombstone its week would have written anyway, so there is no skip-list field
- `mergeSchedule(local, remote)` — per-entry LWW on `_ts`, tombstones winning outright
- `moveNodeToNextWeek(nodeId)` — moves a single node (and subtree) to the next ISO week
- `addBranch(side)` / `deleteBranch(id)` — dynamic branch management
- `applyBranchColor(branch, hex)` — updates branch color palette and re-renders
- `syncStatusUp(nodeId, prop)` — propagates status up the tree after a child changes. `'unplanned'` uses the plain `every()` rule; `'done'` and `'dropped'` are two values on one outcome axis and are recomputed together — a parent is `dropped` when every child is dropped, and `done` when every child is closed (`done || dropped`) **and** at least one is done
- `getDroppedItems(dateStr)` — agenda rows for tasks dropped on a given date, keyed on `droppedAt` exactly as the Done log is keyed on `doneAt`
- `isAgendaRowNode(n)` — whether a node is eligible to be an agenda row of its own; shared by the cross-day Done scan and the Dropped group

## Coding Standards & Conventions
- **Single File Policy**: Keep everything in `zenit-week.html` — never split into separate files. The one exception is `sw.js`: browsers only accept a service worker from a same-origin script URL, so it cannot be inlined or loaded from a `blob:`. Nothing else may leave the single file; do not treat `sw.js` as licence to split further. It holds exactly two concerns — shell caching, and draining the offline upload queue on a Background Sync event. Keep application logic out of both: the page serializes the upload payload and its content hash, and the worker only decides whether pushing is safe (`canPushEntry`). CRDT merging, hashing and layout never move into the worker.
- **JavaScript**:
  - Always use `'use strict';`
  - Prefer `const` and `let` over `var`
  - Use camelCase for function and variable names
  - Avoid code duplication; prioritize modularity and reuse
  - Create SVG elements with `document.createElementNS('http://www.w3.org/2000/svg', tag)`
  - **Never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` with any user-controlled string** (node labels, branch names, or any data that originates from `weekData` or external sources such as Google Drive). Use `textContent`, `createTextNode()`, or explicit DOM construction (`createElement` + property assignment) instead. The only acceptable use of `innerHTML` is with fully static, constant strings that are entirely defined in code and never contain user data (e.g. calls to `iconSvg()`). Violating this rule opens XSS attack vectors — Drive sync means untrusted data can arrive even in a local-file context.
- **CSS**:
  - Use Flexbox for layout
  - Use kebab-case for IDs and class names
  - Keep all styles in the `<style>` tag in `<head>`
- **Cascading behavior**:
  - Done, dropped and priority changes cascade to all descendants
  - Counter nodes auto-mark done when reaching max value
  - `done` and `dropped` are mutually exclusive — setting either clears the other and its timestamps, at **every** write site, not just `setStatus`
  - Dropping a counter freezes `val` where it stands; it is not zeroed and not filled to `max`

## Workflows
- **Running**: Open `zenit-week.html` directly in any modern browser — no server needed
- **Development**: Edit `zenit-week.html`, refresh browser to test
- **Testing**: Manual verification in browser — check drag-and-drop, zoom/pan, undo/redo, and localStorage persistence across refreshes. For data-logic changes also run the automated suite:
  ```sh
  npm install       # only needed once
  npm test          # vitest
  npm run validate  # html-validate
  ```

## UI/UX Guidelines
- **Visual Style**: Modern, clean interface with rounded corners, soft shadows, professional color palette
- **Interactions**: Support both mouse (click/drag) and keyboard shortcuts:
  - Arrow keys — move the mindmap focus ring (`kbFocusId`); it sets `hoveredNodeId`, so every hovered-node hotkey below works without a mouse
  - `Enter` — rename hovered node
  - `Tab` — add child to hovered node
  - `Backspace` / `Delete` — delete hovered node (clear the week on the root)
  - `D` — toggle done on hovered node
  - `U` — toggle unplanned on hovered node
  - `X` — toggle dropped on hovered node
  - `P` — cycle priority on hovered node
  - `C` — comment on hovered node
  - `R` — toggle reusable on hovered node
  - `N` — move hovered node to next week
  - `1`–`7` / `8` — set / clear days on hovered node; on empty canvas they set the day filter (`0` = overdue)
  - `M` / `A` / `S` — Mindmap / Agenda / Stats view; `L` — Agenda on the Later tab
  - `Q` — open the quick-add inbox panel
  - `?` / `H` — toggle Help & Hotkeys
  - `F` — fit the mindmap to the view; `V` — cycle view level (Sand · Pebbles · Rocks)
  - `[` / `]` or `Shift + ←` / `Shift + →` — previous / next week; `T` — jump to the current week
  - Agenda: `↑` / `↓` between items, `←` / `→` between day tabs, `1`–`7` / `0` to jump
  - `Ctrl/⌘ + Z` — undo
  - `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y` — redo
  - `Esc` — close open panel/menu
- **Dark mode**: Full light/dark theme with toggle in settings; respects `prefers-color-scheme` on first load; stored in `localStorage` as `zenit-week-theme`
- **Feedback**: Provide visual cues for hover states and active operations (e.g., "panning" cursor, context menu with context-aware options)
- **Context menus**: Hide options that don't apply to the current node type
- **Agenda view**: One of the three top-level views (`M` / `A` / `S`), not a sidebar. A day-tab strip (`1`–`7`, plus an Overdue tab on `0`) over a list of that day's activities, grouped into `Scheduled`, `Done`, `Any day` and `Dropped` — in that render order. Rows drag to reorder, swipe right to toggle done/undone (undrop, in the Dropped group), swipe left for the context menu
- **Dropped status**: A third value on the outcome axis (open / done / dropped) — "this will not happen", without erasing the task. On the map: branch colour at ~45% opacity, a corner-to-corner diagonal slash and a ⊘ badge; never Done's grey or horizontal strike-through, never the dashed stroke reserved for keyboard focus. Dropped tasks stay in the stats denominator in their own grey band, never arrive via `Transfer Unfinished`, never show as overdue, and are revived (flag cleared) by `Transfer Reusable` and `Next week`. `ctx-undone` is the shared way back to open from either closed state — there is no separate un-drop menu item
- **Daily log**: Not a separate panel — the Agenda's `Done` section is the day log: one row per activity completed or tick recorded that day, ordered by `doneAt`, with branch color dots and `n/total` tick pills. The `daily-log-*` class prefix is legacy naming for the shared agenda-row internals built by `buildAgendaItem()`; it is only ever called from the Agenda
- **Week statistics**: Live in the Stats view (`S`) — donut, per-branch follow-through, effort baseline and the multi-week cumulative flow, all fed by `computeWeekStats()`. `updateSummary()` does not render a drawer; it rebuilds the Help legend's branch items, refreshes the root node's completion ring via `updateCenterRing()`, and re-renders the Stats panel when it is open
- **Send to the Future**: *Reschedule → Date* (last entry in the reschedule submenu, between the weekdays and *Any*; `activity` nodes only, which excludes ticks and day-leaves) moves a task out of this week into a schedule entry, subtree and ancestor path included; the week that owns the date materialises it back on open. One undo reverses both halves — snapshots carry `scheduleRaw`, and an operation reports the entries it created via `_noteScheduleAdditions`, read back per id exactly as `nextWeekAdded` is. Missed occurrences sweep onto the current week's Monday leaf, one item per entry however long the absence
- **Later tab**: last in `AGENDA_TAB_ORDER`, reachable with `L`. A month-grouped reference list of upcoming occurrences, **no badge** — which is also why the agenda strip's staleness key needs nothing added for it. Rows use `buildAgendaItem` in entry mode: no Done, drag, swipe or context menu, because there is no node yet for those to act on. A row opens its entry; deleting from it asks *this occurrence* or *the whole series*
- **Reusable tasks**: Activity nodes can be marked `reusable`; `Transfer Reusable` copies them (with counters reset) to the next week
- **Google Drive Sync**: Optional sign-in with Google to sync data across devices; stored only in the user's own Google Drive — Zenit Week runs no servers that hold user data (the sole backend is `/api/token`, an OAuth token-exchange function) and never stores user data itself
- **Internationalization**: English and Czech UI supported; `t(key)` helper reads from `TRANSLATIONS[currentLang]`; language persisted as `zenit-week-lang` in `localStorage` and synced via Drive
- **Deleting a task**: `deleteNode(id)` deletes at once, from every entry point (context menu, `Backspace`/`Delete` on the map, `Delete` in the Agenda, and programmatic callers). Nothing is asked: Drop is its own menu item and its own hotkey (`X`), so choosing Delete has already answered that question
- **Dialogs**: Never use browser-native `confirm()`, `alert()`, or `prompt()`. Always use the app's custom confirm dialog — `showAppConfirm({ title, body, okLabel, danger, onConfirm })`. Every dialog in the app is built from one vocabulary — `.dialog-shell` (glass surface), `.dialog-header` + `.dialog-title` (tinted caption bar, 15px/700, `.help-close-btn` X on the right), `.dialog-body`, `.dialog-actions`, `.dialog-field` — worn by the confirm, Set a date, the colour picker, the baseline panel, quick add, the coachmarks, the onboarding nudge and the update banner. A new dialog reuses those classes; it never invents a caption, field or button style of its own. `Cancel` stays only where the dialog asks a question whose other answers commit (sign-out, reset, import); a dialog that configures a value is cancelled by its X

## Workflow Rules
- **One branch, one working tree**: Every branch lives in its own directory, so several branches can be worked on at once on this machine. Never `git checkout` a different branch inside an existing checkout — create a worktree instead (`git worktree add ../zenit-week-<branch> <branch>`). Before the first commit of any branch-scoped task, run `git worktree list` and confirm the current directory is on the intended branch; re-check after any gap, because the checkout can move underneath you.
- **No code in conversation**: Never show source code, diffs, or snippets in replies to the user — not in explanations, not in summaries, not in plans. Describe changes in prose (and tables where useful). Code belongs in files only. Exceptions: git commit messages, and shell commands the user is asked to run.
- **After every implementation**: summarize the change as a one-liner git commit message, then ask the user "Should I add and commit?" Never commit (or push) without asking first — the user decides when history changes.
- **End every reply with the next actions**: whenever anything is left for the user to do — verify in the browser, run a command, approve a commit, push, make a decision — close the reply with a short numbered "What to do next" list, one line per step, concrete and in order. No action pending: no list.
- **Chrome testing token budget**: When verifying in the browser (chrome-devtools MCP — navigating, seeding data, screenshots, `evaluate_script`), if a single testing effort burns more than ~5K tokens (especially when wrangling the environment, e.g. importing/seeding data into IndexedDB), stop and ask the user to set up the app state instead of grinding on it. Tell them what state you need (week populated, language, panel open), then just screenshot/measure to confirm.

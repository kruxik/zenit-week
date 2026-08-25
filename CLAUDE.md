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
      done, unplanned, priority, reusable, offX, offY, side, _editing,
      // counter nodes only:
      val, max, ticks,       // ticks: ISO timestamp per increment (drives daily log)
      // timestamps:
      doneAt,                // set when marked done
      unplannedAt,           // set when marked unplanned
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
- `moveNodeToNextWeek(nodeId)` — moves a single node (and subtree) to the next ISO week
- `addBranch(side)` / `deleteBranch(id)` — dynamic branch management
- `applyBranchColor(branch, hex)` — updates branch color palette and re-renders
- `syncStatusUp(nodeId, prop)` — propagates done/unplanned status up the tree after a child changes

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
  - Done status and priority changes cascade to all descendants
  - Counter nodes auto-mark done when reaching max value

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
  - `P` — cycle priority on hovered node
  - `C` — comment on hovered node
  - `R` — toggle reusable on hovered node
  - `N` — move hovered node to next week
  - `1`–`7` / `8` — set / clear days on hovered node; on empty canvas they set the day filter (`0` = overdue)
  - `M` / `A` / `S` — Mindmap / Agenda / Stats view
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
- **Agenda view**: One of the three top-level views (`M` / `A` / `S`), not a sidebar. A day-tab strip (`1`–`7`, plus an Overdue tab on `0`) over a list of that day's activities, grouped into `Scheduled`, `Any day` and `Done`. Rows drag to reorder, swipe right to toggle done/undone, swipe left for the context menu
- **Daily log**: Not a separate panel — the Agenda's `Done` section is the day log: one row per activity completed or tick recorded that day, ordered by `doneAt`, with branch color dots and `n/total` tick pills. The `daily-log-*` class prefix is legacy naming for the shared agenda-row internals built by `buildAgendaItem()`; it is only ever called from the Agenda
- **Week statistics**: Live in the Stats view (`S`) — donut, per-branch follow-through, effort baseline and the multi-week cumulative flow, all fed by `computeWeekStats()`. `updateSummary()` does not render a drawer; it rebuilds the Help legend's branch items, refreshes the root node's completion ring via `updateCenterRing()`, and re-renders the Stats panel when it is open
- **Reusable tasks**: Activity nodes can be marked `reusable`; `Transfer Reusable` copies them (with counters reset) to the next week
- **Google Drive Sync**: Optional sign-in with Google to sync data across devices; stored only in the user's own Google Drive — Zenit Week runs no servers that hold user data (the sole backend is `/api/token`, an OAuth token-exchange function) and never stores user data itself
- **Internationalization**: English and Czech UI supported; `t(key)` helper reads from `TRANSLATIONS[currentLang]`; language persisted as `zenit-week-lang` in `localStorage` and synced via Drive
- **Dialogs**: Never use browser-native `confirm()`, `alert()`, or `prompt()`. Always use the app's custom confirm dialog — `showAppConfirm({ title, body, okLabel, danger, onConfirm })` — or add a new styled dialog following the `#app-confirm-overlay` / `#app-confirm-dialog` pattern

## Workflow Rules
- **One branch, one working tree**: Every branch lives in its own directory, so several branches can be worked on at once on this machine. Never `git checkout` a different branch inside an existing checkout — create a worktree instead (`git worktree add ../zenit-week-<branch> <branch>`). Before the first commit of any branch-scoped task, run `git worktree list` and confirm the current directory is on the intended branch; re-check after any gap, because the checkout can move underneath you.
- **No code in conversation**: Never show source code, diffs, or snippets in replies to the user — not in explanations, not in summaries, not in plans. Describe changes in prose (and tables where useful). Code belongs in files only. Exceptions: git commit messages, and shell commands the user is asked to run.
- **After every implementation**: summarize the change as a one-liner git commit message, then ask the user "Should I add and commit?" Never commit (or push) without asking first — the user decides when history changes.
- **End every reply with the next actions**: whenever anything is left for the user to do — verify in the browser, run a command, approve a commit, push, make a decision — close the reply with a short numbered "What to do next" list, one line per step, concrete and in order. No action pending: no list.
- **Chrome testing token budget**: When verifying in the browser (chrome-devtools MCP — navigating, seeding data, screenshots, `evaluate_script`), if a single testing effort burns more than ~5K tokens (especially when wrangling the environment, e.g. importing/seeding data into IndexedDB), stop and ask the user to set up the app state instead of grinding on it. Tell them what state you need (week populated, language, panel open), then just screenshot/measure to confirm.

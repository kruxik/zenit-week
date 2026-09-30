# Zenit Week - Claude Instructions

## Project Overview
A visually rich, single-file web application for planning weeks using a Mind Map interface. It uses SVG for rendering and `localStorage` for data persistence.

## Architecture

### Data Model
```javascript
weekData = {
  nodes: [
    { id, type, branch, label, parent, children,
      done, unplanned, dropped, priority, reusable, offX, offY, side, _editing,
      comments,              // activity only: one Markdown string in the fixed comment grammar
      // counter nodes only:
      val, max, ticks,       // ticks: ISO timestamp per increment (drives daily log)
      // timestamps:
      doneAt,                // set when marked done
      unplannedAt,           // set when marked unplanned
      droppedAt,             // set when marked dropped
      _ts,                   // epoch ms — Drive merge conflict resolution, content only
      _posTs }               // epoch ms — same role for `offX`/`offY`/`side` alone
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

Dated work (Send to the Future, the `schedule` record, occurrences, the Later tab) is documented in the `schedule` skill at `.claude/skills/schedule/SKILL.md` — load it before touching that code.

### Rendering
- Full `render()` on structural changes
- Surgical `updateNodeUI()` for visual-only updates (avoid full re-render when possible)
- `updateSummary()` for stats panel refresh
- `computeLayout()` calculates radial positions using recursive height and priority-based scaling (critical: 2.0x, high: 1.5x, normal: 1.0x); branches split left/right per `BRANCH_CONFIG`

### Key Functions
- `genId()` — generates a node ID using `crypto.randomUUID()` with a `crypto.getRandomValues` fallback for plain-HTTP contexts; always call this, never `crypto.randomUUID()` directly
- `touchNode(id)` / `touchLayout(id)` — the two merge stamps, and the line between them. `touchNode` says *content* changed (`_ts`, and it drops `_demo`); `touchLayout` says only *where the node sits* changed (`_posTs`, `_demo` untouched). A move — recenter-all, a drop, a branch side flip, a children reorder — calls `touchLayout` and never `touchNode`, because a device holding a stale week must not promote its copy of every node it dragged past. `mergeWeekData` reads the two independently: the node body from the higher `_ts`, `offX`/`offY`/`side` from the higher `_posTs`, both tying to remote
- `openWeekIntoView(wk)` — the single week-open path. `loadAndRender` (arrows, week bar, boot) and the `hashchange` handler both route through it, so materialisation hooks one place. Takes the week lock, which is **not** re-entrant
- `syncStatusUp(nodeId, prop)` — propagates status up the tree after a child changes. `'unplanned'` uses the plain `every()` rule; `'done'` and `'dropped'` are two values on one outcome axis and are recomputed together — a parent is `dropped` when every child is dropped, and `done` when every child is closed (`done || dropped`) **and** at least one is done
- `getDroppedItems(dateStr)` — agenda rows for tasks dropped on a given date, keyed on `droppedAt` exactly as the Done log is keyed on `doneAt`
- `isAgendaRowNode(n)` — whether a node is eligible to be an agenda row of its own; shared by the cross-day Done scan and the Dropped group

## Coding Standards & Conventions
- **Single File Policy**: Keep everything in `zenit-week.html` — never split into separate files. The one exception is `sw.js`: browsers only accept a service worker from a same-origin script URL, so it cannot be inlined or loaded from a `blob:`. The second and last exception is `vendor/editor.<hash>.js`, the lazy-loaded ProseMirror bundle for the comment editor: third-party code only, built from `vendor/editor-entry.js` (re-exports, nothing else) by `npm run editor:build` and SRI-pinned by the `COMMENT_EDITOR_BUNDLE` constant — the comment grammar, schema, Markdown bridge, loader and autosave stay in `zenit-week.html`. Nothing else may leave the single file; do not treat either exception as licence to split further. `sw.js` holds exactly two concerns — shell caching (the editor bundle included), and draining the offline upload queue on a Background Sync event. Keep application logic out of both: the page serializes the upload payload and its content hash, and the worker only decides whether pushing is safe (`canPushEntry`). CRDT merging, hashing and layout never move into the worker.
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
- **Testing**: Manual verification in browser — check drag-and-drop, zoom/pan, undo/redo, and localStorage persistence across refreshes. For data-logic changes also run the automated suite:
  ```sh
  npm test          # vitest
  npm run validate  # html-validate
  ```

## UI/UX Guidelines
- **Visual Style**: Modern, clean interface with rounded corners, soft shadows, professional color palette
- **Interactions**: Support both mouse (click/drag) and keyboard shortcuts. The keydown handler and the Help panel are the source of truth for hotkeys; check them for collisions before adding one.
- **Dark mode**: Full light/dark theme with toggle in settings; respects `prefers-color-scheme` on first load; stored in `localStorage` as `zenit-week-theme`
- **Feedback**: Provide visual cues for hover states and active operations (e.g., "panning" cursor, context menu with context-aware options)
- **Context menus**: Hide options that don't apply to the current node type
- **Agenda view**: One of the three top-level views (`M` / `A` / `S`), not a sidebar. A day-tab strip (`1`–`7`, plus an Overdue tab on `0`) over a list of that day's activities, grouped into `Scheduled`, `Done`, `Any day` and `Dropped` — in that render order. Rows drag to reorder, swipe right to toggle done/undone (undrop, in the Dropped group), swipe left for the context menu
- **Dropped status**: A third value on the outcome axis (open / done / dropped) — "this will not happen", without erasing the task. On the map: branch colour at ~45% opacity, a corner-to-corner diagonal slash and a ⊘ badge; never Done's grey or horizontal strike-through, never the dashed stroke reserved for keyboard focus. Dropped tasks stay in the stats denominator in their own grey band, never arrive via `Transfer Unfinished`, never show as overdue, and are revived (flag cleared) by `Transfer Reusable` and `Next week`. `ctx-undone` is the shared way back to open from either closed state — there is no separate un-drop menu item
- **Daily log**: Not a separate panel — the Agenda's `Done` section is the day log: one row per activity completed or tick recorded that day, ordered by `doneAt`, with branch color dots and `n/total` tick pills. The `daily-log-*` class prefix is legacy naming for the shared agenda-row internals built by `buildAgendaItem()`; it is only ever called from the Agenda
- **Week statistics**: Live in the Stats view (`S`) — donut, per-branch follow-through, effort baseline and the multi-week cumulative flow, all fed by `computeWeekStats()`. `updateSummary()` does not render a drawer; it rebuilds the Help legend's branch items, refreshes the root node's completion ring via `updateCenterRing()`, and re-renders the Stats panel when it is open
- **Rich comments**: `node.comments` stays one plain string — Markdown in a fixed micro-grammar (`# ` heading, `- ` or `* ` bullet, `- [ ] ` / `- [x] ` checkbox, `**bold**`, `*italic*`, `[text](url)`, bare URL; everything else literal, no nesting, no escapes). `tokenizeComment()` is the single reader for the editor, the Agenda preview and the counter, and an untouched comment must re-serialize byte-identically. Link targets are `http:` / `https:` / `mailto:` only (`isSafeCommentUrl`), checked in the tokenizer, the schema's paste rule and every open path. The editor loads lazily; when it cannot, the plain textarea is the fallback. `npm run release` refuses to ship an outdated or stale editor bundle
- **Reusable tasks**: Activity nodes can be marked `reusable`; `Transfer Reusable` copies them (with counters reset) to the next week
- **Google Drive Sync**: Optional sign-in with Google to sync data across devices; stored only in the user's own Google Drive — Zenit Week runs no servers that hold user data (the sole backend is `/api/token`, an OAuth token-exchange function) and never stores user data itself
- **Internationalization**: English and Czech UI supported; `t(key)` helper reads from `TRANSLATIONS[currentLang]`; language persisted as `zenit-week-lang` in `localStorage` and synced via Drive
- **Deleting a task**: `deleteNode(id)` deletes at once, from every entry point (context menu, `Backspace`/`Delete` on the map, `Delete` in the Agenda, and programmatic callers). Nothing is asked: Drop is its own menu item and its own hotkey (`X`), so choosing Delete has already answered that question. The one exception, an occurrence of a repeating schedule entry, is documented in the `schedule` skill.
- **Dialogs**: Never use browser-native `confirm()`, `alert()`, or `prompt()`. Always use the app's custom confirm dialog — `showAppConfirm({ title, body, okLabel, danger, onConfirm })`. Every dialog in the app is built from one vocabulary — `.dialog-shell` (glass surface), `.dialog-header` + `.dialog-title` (tinted caption bar, 15px/700, `.help-close-btn` X on the right), `.dialog-body`, `.dialog-actions`, `.dialog-field` — worn by the confirm, Set a date, the colour picker, the baseline panel, quick add, the coachmarks, the onboarding nudge and the update banner. A new dialog reuses those classes; it never invents a caption, field or button style of its own. `Cancel` stays only where the dialog asks a question whose other answers commit (sign-out, reset, import); a dialog that configures a value is cancelled by its X

## Workflow Rules
- **One branch, one working tree**: Every branch lives in its own directory, so several branches can be worked on at once on this machine. Never `git checkout` a different branch inside an existing checkout — create a worktree instead (`git worktree add ../zenit-week-<branch> <branch>`). Before the first commit of any branch-scoped task, run `git worktree list` and confirm the current directory is on the intended branch; re-check after any gap, because the checkout can move underneath you.
- **No code in conversation**: Never show source code, diffs, or snippets in replies to the user — not in explanations, not in summaries, not in plans. Describe changes in prose (and tables where useful). Code belongs in files only. Exceptions: git commit messages, and shell commands the user is asked to run.
- **After every implementation**: summarize the change as a one-liner git commit message, then ask the user "Should I add and commit?" Never commit (or push) without asking first — the user decides when history changes.
- **End every reply with the next actions**: whenever anything is left for the user to do — verify in the browser, run a command, approve a commit, push, make a decision — close the reply with a short numbered "What to do next" list, one line per step, concrete and in order. No action pending: no list.
- **Chrome testing token budget**: When verifying in the browser (chrome-devtools MCP — navigating, seeding data, screenshots, `evaluate_script`), if a single testing effort burns more than ~5K tokens (especially when wrangling the environment, e.g. importing/seeding data into IndexedDB), stop and ask the user to set up the app state instead of grinding on it. Tell them what state you need (week populated, language, panel open), then just screenshot/measure to confirm.

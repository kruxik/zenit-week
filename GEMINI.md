# Zenit Week - Gemini Instructions

## Project Overview
A visually rich, single-file web application for planning weeks using a Mind Map interface. It uses SVG for rendering and `localStorage` for data persistence.

## Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, and JavaScript (ES6+).
- **Graphics**: Inline SVG for the mind map visualization; bezier curves for node connections.
- **State Management**: In-memory `weekData` object persisted to `localStorage` per ISO week; `nodeMap` (`Map<id, node>`) for O(1) lookups.
- **Text Sizing**: Canvas `measureText()` for precise SVG text sizing.
- **Icons/Assets**: Native Unicode characters and CSS-based shapes.

## Key Files
- `zenit-week.html`: The entire application (HTML, CSS, and JS).

## Architecture

### Data Model
```javascript
weekData = {
  nodes: [
    { id, type, branch, label, parent, children,
      done, unplanned, priority, reusable, offX, offY, side,
      // counter nodes:
      val, max, ticks,       // ticks: ISO timestamp per increment (drives daily log)
      // timestamps:
      doneAt,                // set when marked done
      unplannedAt,           // set when marked unplanned
      _ts }                  // epoch ms — Drive merge conflict resolution
  ]
}
```

Node types:
- **center** — virtual root (week label)
- **branch** — user-managed categories (default: work, family, me); can add/delete; minimum 1 must remain
- **activity** — user-created tasks; can be marked `reusable`
- **counter** — auto-created child when activity label matches `Nx` pattern; tracks `val`/`max`

`BRANCH_CONFIG` — maps `branchId → { side: 'left' | 'right' }`; controls radial placement.

Week key format: `YYYY-WW`, stored as `zenit-week-YYYY-WW` in `localStorage`.

Default branch colors: Work `#F24E1E`, Family `#A259FF`, Me `#1ABCFE` — all customizable via color picker.

### Priority System
- Three levels: `normal` (1.0×), `high` (1.5×), `critical` (2.0×)
- Priority scales radial layout spacing and visual weight
- Changes cascade to all descendant nodes

### Rendering
- `computeLayout()` — radial layout; branches split left/right per `BRANCH_CONFIG`
- `render()` — full SVG rebuild on structural changes
- `updateNodeUI()` — surgical update for visual-only changes
- `updateSummary()` — refreshes stats panel

### Key Functions
- `findNode(id)` — O(1) lookup via `nodeMap` (`Map<id, node>`, rebuilt on every structural change)
- `genId()` — generates a node ID; prefer over `crypto.randomUUID()` directly (has HTTP fallback)
- `getDescendantIds(id)` — recursively collects subtree IDs
- `validateAndRepair()` — garbage collection and orphan cleanup
- `transferUnfinished()` — copies incomplete activity nodes from previous ISO week to current
- `transferReusable()` — copies nodes marked `reusable: true` (counters reset) to current week
- `moveNodeToNextWeek(nodeId)` — moves a single node (and subtree) to the next ISO week
- `addBranch(side)` / `deleteBranch(id)` — dynamic branch management
- `applyBranchColor(branch, hex)` — updates branch color palette and re-renders
- `syncStatusUp(nodeId, prop)` — propagates done/unplanned status up the tree after a child changes

## Coding Standards & Conventions
- **Single File Policy**: Maintain the entire application within `zenit-week.html`.
- **JavaScript**:
  - Use `'use strict';`.
  - Prefer `const` and `let` over `var`.
  - Use camelCase for function and variable names.
  - Avoid code duplication; prioritize modularity and reuse.
  - Create SVG elements using `document.createElementNS('http://www.w3.org/2000/svg', tag)`.
  - Use `genId()` for ID generation — it calls `crypto.randomUUID()` with a `crypto.getRandomValues` fallback for plain-HTTP contexts.
  - **Never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` with any user-controlled string** (node labels, branch names, or any data that originates from `weekData` or external sources such as Google Drive). Use `textContent`, `createTextNode()`, or explicit DOM construction (`createElement` + property assignment) instead. The only acceptable use of `innerHTML` is with fully static, constant strings that are entirely defined in code and never contain user data (e.g. calls to `iconSvg()`). Violating this rule opens XSS attack vectors — Drive sync means untrusted data can arrive even in a local-file context.
- **CSS**:
  - Use Flexbox for layout.
  - Follow kebab-case for IDs and classes.
  - Keep styles scoped within the `<style>` tag in the header.

## Workflows
- **Running**: Open `zenit-week.html` directly in any modern web browser.
- **Development**: Edit `zenit-week.html` and refresh the browser.
- **Testing**: Manual verification in the browser. Ensure drag-and-drop, zooming, undo/redo, and data persistence work across refreshes. For data-logic changes also run the automated suite:
  ```sh
  npm install       # only needed once
  npm test          # vitest
  npm run validate  # html-validate
  ```

## UI/UX Guidelines
- **Visual Style**: Modern, clean interface with rounded corners, soft shadows, and a professional color palette.
- **Dark mode**: Full light/dark theme toggle in settings; respects `prefers-color-scheme` on first load.
- **Interactions**: Support both mouse (click/drag) and keyboard shortcuts:
  - `Enter` — rename hovered node
  - `Tab` — add child to hovered node
  - `Backspace` / `Delete` — delete hovered node
  - `D` — toggle done
  - `U` — toggle unplanned
  - `Ctrl/⌘ + Z` — undo (100 levels)
  - `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y` — redo
  - `Esc` — close open panel/menu
- **Feedback**: Provide visual cues for hover states and active operations (e.g., "panning" cursor, context menu with context-aware options).
- **Context menus**: Hide options that don't apply to the current node type.
- **Panels**:
  - **Todo panel** — lists all incomplete activity nodes; accessible from toolbar.
  - **Daily log panel** — floating panel showing completed/ticked activities for today with timestamps.
  - **Summary panel** — expandable drawer showing per-branch done/total stats and a global completion percentage.
- **Reusable tasks**: Activity nodes can be marked `reusable`; "Transfer Reusable" copies them (counters reset) to the next week.
- **Google Drive Sync**: Optional sign-in with Google to sync data across devices; stored only in the user's own Google Drive — Zenit Week has no servers and never stores user data itself.
- **Internationalization**: English and Czech UI supported; `t(key)` helper reads from `TRANSLATIONS[currentLang]`; language persisted as `zenit-week-lang` in `localStorage` and synced via Drive.
- **Dialogs**: Never use browser-native `confirm()`, `alert()`, or `prompt()`. Always use the app's custom confirm dialog — `showAppConfirm({ title, body, okLabel, danger, onConfirm })` — or add a new styled dialog following the `#app-confirm-overlay` / `#app-confirm-dialog` pattern.

## Workflow Rules
- **After every implementation**: summarize the change as a one-liner git commit message, then ask the user "Should I add and commit?"

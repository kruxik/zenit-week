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
- `zenit-week.html`: The entire application (HTML, CSS, and JS) — ~5,150 lines

## Architecture

### Data Model
```javascript
weekData = {
  nodes: [
    { id, type, branch, label, parent, children,
      done, unplanned, priority, reusable, offX, offY, side, _editing,
      // counter nodes only:
      val, max,
      // timestamps:
      doneAt }
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
- `getDescendantIds(id)` — recursively collects subtree
- `validateAndRepair()` — garbage collection and orphan cleanup
- `transferUnfinished()` — copies incomplete activity nodes from previous ISO week to current
- `transferReusable()` — copies nodes marked `reusable: true` (with counters reset) to current week
- `addBranch(side)` / `deleteBranch(id)` — dynamic branch management
- `applyBranchColor(branch, hex)` — updates branch color palette and re-renders

## Coding Standards & Conventions
- **Single File Policy**: Keep everything in `zenit-week.html` — never split into separate files
- **JavaScript**:
  - Always use `'use strict';`
  - Prefer `const` and `let` over `var`
  - Use camelCase for function and variable names
  - Avoid code duplication; prioritize modularity and reuse
  - Create SVG elements with `document.createElementNS('http://www.w3.org/2000/svg', tag)`
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
- **Testing**: Manual verification in browser — check drag-and-drop, zoom/pan, undo/redo, and localStorage persistence across refreshes

## UI/UX Guidelines
- **Visual Style**: Modern, clean interface with rounded corners, soft shadows, professional color palette
- **Interactions**: Support both mouse (click/drag) and keyboard shortcuts:
  - `Enter` — rename hovered node
  - `Tab` — add child to hovered node
  - `Backspace` / `Delete` — delete hovered node
  - `D` — toggle done on hovered node
  - `U` — toggle unplanned on hovered node
  - `Ctrl/⌘ + Z` — undo
  - `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y` — redo
  - `Esc` — close open panel/menu
- **Dark mode**: Full light/dark theme with toggle in settings; respects `prefers-color-scheme` on first load; stored in `localStorage` as `zenit-week-theme`
- **Feedback**: Provide visual cues for hover states and active operations (e.g., "panning" cursor, context menu with context-aware options)
- **Context menus**: Hide options that don't apply to the current node type
- **Todo panel**: Sidebar listing all incomplete activity nodes across the week; accessible via toolbar button
- **Daily log panel**: Floating panel showing completed/ticked activities for the day, with timestamps and branch color dots
- **Reusable tasks**: Activity nodes can be marked `reusable`; `Transfer Reusable` copies them (with counters reset) to the next week
- **Dialogs**: Never use browser-native `confirm()`, `alert()`, or `prompt()`. Always use the app's custom confirm dialog — `showAppConfirm({ title, body, okLabel, danger, onConfirm })` — or add a new styled dialog following the `#app-confirm-overlay` / `#app-confirm-dialog` pattern

## Workflow Rules
- **After every implementation**: summarize the change as a one-liner git commit message, then ask the user "Should I add and commit?"

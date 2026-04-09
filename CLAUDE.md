# Week Planner - Claude Instructions

## Project Overview
A visually rich, single-file web application for planning weeks using a Mind Map interface. It uses SVG for rendering and `localStorage` for data persistence.

## Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, and JavaScript (ES6+)
- **Graphics**: Inline SVG for mind map visualization, bezier curves for node connections
- **State Management**: In-memory `weekData` object persisted to `localStorage` per ISO week
- **Text Sizing**: Canvas `measureText()` for precise SVG text measurement
- **Icons/Assets**: Native Unicode characters and CSS-based shapes

## Key Files
- `week-planner.html`: The entire application (HTML, CSS, and JS) — ~2,910 lines

## Architecture

### Data Model
```javascript
weekData = {
  nodes: [
    { id, type, branch, label, parent, children,
      done, unplanned, priority, offX, offY, _editing }
  ]
}
```

Node hierarchy:
- **center**: Virtual root (week label)
- **branch**: Three fixed categories — `work`, `family`, `me`
- **activity**: User-created tasks (may have counter children)

Branch colors: Work `#F24E1E`, Family `#A259FF`, Me `#1ABCFE`

Week key format: `YYYY-WW` (e.g., `2026-14`), stored in localStorage as `week-planner-2026-14`

### Rendering
- Full `render()` on structural changes
- Surgical `updateNodeUI()` for visual-only updates (avoid full re-render when possible)
- `updateSummary()` for stats panel refresh
- `computeLayout()` calculates radial positions using recursive height and priority-based scaling (critical: 2.0x, high: 1.5x, normal: 1.0x)

### Key Functions
- `findNode(id)` — linear search through nodes array
- `getDescendantIds(id)` — recursively collects subtree
- `validateAndRepair()` — garbage collection and orphan cleanup
- `transferUnfinished()` — cross-week task migration

## Coding Standards & Conventions
- **Single File Policy**: Keep everything in `week-planner.html` — never split into separate files
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
- **Running**: Open `week-planner.html` directly in any modern browser — no server needed
- **Development**: Edit `week-planner.html`, refresh browser to test
- **Testing**: Manual verification in browser — check drag-and-drop, zoom/pan, undo/redo, and localStorage persistence across refreshes

## UI/UX Guidelines
- **Visual Style**: Modern, clean interface with rounded corners, soft shadows, professional color palette
- **Interactions**: Support both mouse (click/drag) and keyboard shortcuts (Enter to commit, Esc to cancel, Tab to add child, D to toggle done, U to toggle unplanned, Backspace to delete)
- **Feedback**: Provide visual cues for hover states and active operations (e.g., "panning" cursor, context menu with context-aware options)
- **Context menus**: Hide options that don't apply to the current node type

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
- `week-planner.html`: The entire application (HTML, CSS, and JS) — ~5,150 lines.

## Architecture

### Data Model
```javascript
weekData = {
  nodes: [
    { id, type, branch, label, parent, children,
      done, unplanned, priority, reusable, offX, offY, side,
      // counter nodes: val, max
      // timestamps: doneAt }
  ]
}
```

Node types:
- **center** — virtual root (week label)
- **branch** — user-managed categories (default: work, family, me); can add/delete; minimum 1 must remain
- **activity** — user-created tasks; can be marked `reusable`
- **counter** — auto-created child when activity label matches `Nx` pattern; tracks `val`/`max`

`BRANCH_CONFIG` — maps `branchId → { side: 'left' | 'right' }`; controls radial placement.

Week key format: `YYYY-WW`, stored as `week-planner-YYYY-WW` in `localStorage`.

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

## Coding Standards & Conventions
- **Single File Policy**: Maintain the entire application within `week-planner.html`.
- **JavaScript**:
  - Use `'use strict';`.
  - Prefer `const` and `let` over `var`.
  - Use camelCase for function and variable names.
  - Avoid code duplication; prioritize modularity and reuse.
  - Create SVG elements using `document.createElementNS('http://www.w3.org/2000/svg', tag)`.
  - Use `crypto.randomUUID()` for ID generation.
- **CSS**:
  - Use Flexbox for layout.
  - Follow kebab-case for IDs and classes.
  - Keep styles scoped within the `<style>` tag in the header.

## Workflows
- **Running**: Open `week-planner.html` directly in any modern web browser.
- **Development**: Edit `week-planner.html` and refresh the browser.
- **Testing**: Manual verification in the browser. Ensure drag-and-drop, zooming, undo/redo, and data persistence work across refreshes.

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
  - **Summary panel** — expandable drawer showing per-branch done/total stats.
- **Reusable tasks**: Activity nodes can be marked `reusable`; "Transfer Reusable" copies them (counters reset) to the next week.

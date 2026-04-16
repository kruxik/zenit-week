# Technical Debt & Architecture Improvements

This document tracks identified technical improvements for the Zenit Week application to ensure long-term stability, security, and performance.

## 1. Security: XSS Mitigation (Critical)
**Issue:** The application currently uses `innerHTML` to render user-provided node labels in several places (Summary panel, Daily log, etc.).
**Risk:** Malicious scripts can be injected via task labels.
**Recommendations:**
- Audit all `innerHTML` usage.
- Prefer `textContent` for label rendering.
- Implement a sanitization utility for cases where HTML is necessary.

## 2. Performance: Rendering & Layout
**Issue:** `render()` performs a full SVG rebuild on every change, and `computeLayout()` runs frequently.
**Recommendations:**
- **Surgical DOM Updates:** Expand the usage of `updateNodeUI` to cover more state changes without a full re-render.
- **Layout Caching:** Only re-calculate `computeLayout()` when the tree structure (parent/child relationships) changes.
- **Intersection Observer:** For extremely large maps, consider partial rendering or culling of off-screen SVG elements.

## 3. Architecture: State & Modularity
**Issue:** ~5,800 lines in a single file with heavy reliance on global state.
**Recommendations:**
- **Store Pattern:** Centralize `weekData` management into a dedicated `Store` class/object to handle snapshots, persistence, and state transitions.
- **Namespacing:** Group related functions (e.g., `SVGUtils`, `LayoutEngine`, `EventHandlers`) into objects to reduce global namespace pollution.
- **Structured Cloning:** Replace `JSON.parse(JSON.stringify(obj))` with the native `structuredClone(obj)`.

## 4. History System: Action Deltas
**Issue:** Full JSON snapshots for undo/redo are memory-intensive (100 levels).
**Recommendations:**
- Transition from "State Snapshots" to "Action Deltas" (Command Pattern).
- Store only the change (e.g., `oldValue` vs `newValue`) for specific node properties.

## 5. Accessibility (A11y)
**Issue:** The SVG mind map is currently invisible to screen readers.
**Recommendations:**
- Add ARIA roles (`tree`, `treeitem`) to SVG groups.
- Ensure keyboard focus management follows the visual selection.
- Add `aria-live` regions for status updates (e.g., "Task marked as done").

## 6. Maintenance
**Issue:** The single-file constraint is helpful for distribution but difficult for development.
**Recommendations:**
- Consider a build step that allows developing in separate files while still outputting a single `week-planner.html` for the user.

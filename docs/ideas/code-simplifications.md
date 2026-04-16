# Code Simplification Recommendations

This document identifies complex or redundant code patterns in the Zenit Week application and proposes simpler, more maintainable alternatives.

## 1. Logic Consolidation

### Week Label Formatting
**Current:** Two separate functions, `formatWeekLabel` and `formatWeekLabelHTML`, share ~90% of their logic for calculating dates and handling language strings.
**Simplification:** Create a single `getWeekLabelParts(year, week)` function that returns the week number and the date range string. The specific formatting (HTML vs plain text) can then be applied at the call site.

### Status Management
**Current:** `setStatus` and its inner `setDescendants` have large `if/else` blocks that repeat logic for setting `done`, `unplanned`, and `priority` properties.
**Simplification:** Use a property mapping approach. Create a generic `applyToSubtree(nodeId, propertyMap)` function that recursively updates node properties.
```javascript
const statusMap = {
  done: { done: true, doneAt: now },
  undone: { done: false, doneAt: null }
};
// Use: updateSubtree(id, statusMap[status]);
```

## 2. Layout & Rendering

### Layout Engine Redundancy
**Current:** `computeLayout` contains two nested functions, `layoutSide` and `layoutChildren`, which share identical logic for positioning nodes, calculating offsets, and handling side-specific directions.
**Simplification:** Unify these into a single recursive `layoutNode(nodeId, ...)` function. A branch is just a child of the center node with specific spacing rules.

### DOM Creation
**Current:** `makeNodeGroup` is a massive function (likely 200+ lines) handling rects, text, icons, counters, and buttons.
**Simplification:** Split into small "component" functions:
- `createNodeRect(styles)`
- `createNodeText(lines, styles)`
- `createCounterControls(node)`
- `createNodeIcons(node)`

### Node Styles
**Current:** `getNodeSize` and `getNodeVisuals` both independently determine the node type and calculate scales/priorities.
**Simplification:** Merge into `getNodeStyles(nodeId)`. This avoids redundant lookups and ensures that geometry and colors are calculated from a single source of truth.

## 3. Data Utilities

### Validation Logic
**Current:** `validateAndRepair` uses verbose loops to reconstruct missing branches and purge dead references.
**Simplification:** 
- Use `Array.prototype.filter` and `Map.has` more aggressively.
- Use `Object.assign` or object spread for merging default branch data.

### Cloning
**Current:** `JSON.parse(JSON.stringify(obj))` is used for deep cloning.
**Simplification:** Use the native `structuredClone(obj)`, which is faster and handles more complex types (though not needed for current JSON data, it's a cleaner modern pattern).

## 4. Event Handling

### Keyboard Shortcuts
**Current:** A large `window.addEventListener('keydown')` block handles many different keys with nested `if` statements.
**Simplification:** Use a command map:
```javascript
const keyCommands = {
  'Enter': () => startRenameNode(hoveredNode),
  'Tab': () => startAddNode(hoveredNode),
  'd': () => toggleDone(hoveredNode),
};
// Use: keyCommands[e.key]?.();
```
This is much easier to extend and test than a large switch/if-else block.

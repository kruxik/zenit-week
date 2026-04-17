# Open-Source Readiness TODO

This file tracks all changes needed before open-sourcing `zenit-week.html`.
Each item includes enough context for an AI agent (Claude Code, Gemini, etc.) to implement it without reading any other file first.

---

## 🔴 Blockers — Must fix before publishing

### 1. Add LICENSE file
**File to create:** `LICENSE`
**Action:** Create a standard MIT License file. Use the year 2026 and author name "Petr Burian" (or update to real author name).
**Why:** Without a license, the code is legally unusable by others. This is the single most important step for open-source.

---

### 2. Add README.md
**File to create:** `README.md`
**Action:** Write a README covering:
- What the app is (Zenit Week — mind-map week planner, runs in browser, no server needed)
- Screenshot or GIF (add a placeholder `<!-- add screenshot here -->` comment)
- Quick start: "Download `zenit-week.html` and open in any modern browser"
- Feature list: branches (Work/Family/Me), priorities, counters, drag-and-drop, undo/redo, daily log, cross-week transfer
- Keyboard shortcuts table (copy from the in-app Help panel)
- Data storage: explain localStorage, key format `zenit-week-YYYY-WW`
- Browser support: modern browsers with ES6+ support
- Contributing section linking to CONTRIBUTING.md
**Why:** First thing any GitHub visitor looks for.

---

### 3. Fix silent `catch` blocks — error swallowing
**File:** `zenit-week.html`

**Fix 1 — `loadBranchColors()` around line 1290:**
```js
// BEFORE:
} catch(e) {}

// AFTER:
} catch(e) {
  console.warn('[zenit-week] Failed to load branch colors from localStorage:', e);
}
```

**Fix 2 — `loadWeek()` around line 1540:**
```js
// BEFORE:
} catch(e) {}

// AFTER:
} catch(e) {
  console.warn('[zenit-week] Failed to parse week data for key', wk, '— using defaults:', e);
}
```
**Why:** Silent failures make debugging impossible for users and contributors.

---

### 4. Fix `validateAndRepair()` returning invalid data
**File:** `zenit-week.html`, function `validateAndRepair()` around line 1504.

**Fix:**
```js
// BEFORE:
function validateAndRepair(data) {
  if (!data || !Array.isArray(data.nodes)) return data;

// AFTER:
function validateAndRepair(data) {
  if (!data || !Array.isArray(data.nodes)) return defaultWeekData();
```
Also add at the start of the function body, before any other logic, strip leftover `_editing` flags that can persist after a crash:
```js
data.nodes.forEach(n => { delete n._editing; });
```
**Why:** Returning invalid/null data to callers causes cascading failures. The `_editing` flag can survive a browser crash and corrupt the next session.

---

### 5. Fix `window resize` resetting zoom/pan
**File:** `zenit-week.html`, around line 3568.

**Fix:** Replace the unconditional reset with a bounds check. Only reset if the center of the map has drifted entirely off screen:
```js
// BEFORE:
window.addEventListener('resize', () => {
  resetView();
});

// AFTER:
window.addEventListener('resize', () => {
  // Only reset if the map origin has drifted fully off-screen
  const svg = document.getElementById('main-svg');
  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 600;
  if (panX < 0 || panX > w || panY < 0 || panY > h) {
    resetView();
  }
  if (editState) resizeInlineInput();
});
```
**Why:** Every window resize (DevTools open, snap layouts, browser zoom) currently destroys the user's zoom and pan position.

---

### 6. Handle `localStorage` quota errors in `saveWeek()`
**File:** `zenit-week.html`, function `saveWeek()` around line 1550.

**Fix:**
```js
// BEFORE:
function saveWeek(wk, data) {
  localStorage.setItem(storageKey(wk), JSON.stringify(data));
}

// AFTER:
function saveWeek(wk, data) {
  try {
    localStorage.setItem(storageKey(wk), JSON.stringify(data));
  } catch(e) {
    console.error('[zenit-week] Failed to save week data — localStorage may be full:', e);
    // Optionally show a user-facing warning here
  }
}
```
**Why:** `QuotaExceededError` is a real failure mode that silently loses data without this guard.

---

## 🟠 Performance — Fix before or shortly after launch

### 7. Replace `findNode()` O(n) linear scan with a Map
**File:** `zenit-week.html`

**Action:** After `weekData` is assigned (in `loadAndRender`, `undo`, `redo`, and anywhere `weekData` is mutated), rebuild a `nodeMap`:
```js
let nodeMap = new Map();

function rebuildNodeMap() {
  nodeMap = new Map((weekData.nodes || []).map(n => [n.id, n]));
}

function findNode(id) {
  return nodeMap.get(id);
}
```
Call `rebuildNodeMap()` after every assignment to `weekData` and after `weekData.nodes.push(...)` or `weekData.nodes = weekData.nodes.filter(...)`.
**Why:** `findNode` is called hundreds of times per render. O(1) lookup is a trivial improvement.

---

### 8. Remove `render()` call from `resizeInlineInput()`
**File:** `zenit-week.html`, function `resizeInlineInput()` around line 2253.

**Fix:** Delete the line `render();` at the end of `resizeInlineInput()`.
The inline input already overlays the node visually — a full SVG re-render on every keystroke is unnecessary and causes jank with many nodes.
**Why:** Every character typed currently tears down and rebuilds the entire SVG DOM.

---

### 9. Cache SVG `<linearGradient>` elements instead of recreating on every render
**File:** `zenit-week.html`, function `makeTaperedCurve()` around line 2175.

**Action:** In `makeTaperedCurve`, before creating a new gradient, check if one with the same `gradId` already exists in `defsEl`. If it does, just update its `x1/y1/x2/y2` attributes instead of appending a new element:
```js
function makeTaperedCurve(x1, y1, x2, y2, colorHex, swStart, swEnd, fromId, toId, defsEl) {
  const gradId = `grad-${fromId || 'c'}-${toId || 'c'}`;
  let grad = defsEl.querySelector(`#${gradId}`);
  if (!grad) {
    grad = svgEl('linearGradient', { id: gradId, gradientUnits: 'userSpaceOnUse' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': colorHex, 'stop-opacity': '0.9' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': colorHex, 'stop-opacity': '0.4' }));
    defsEl.appendChild(grad);
  }
  grad.setAttribute('x1', x1); grad.setAttribute('y1', y1);
  grad.setAttribute('x2', x2); grad.setAttribute('y2', y2);
  // ... rest of function unchanged
}
```
**Why:** With 50 nodes, ~50 gradient elements are created and discarded on every full render.

---

## 🟡 Correctness Bugs

### 10. Remove dead code — unused `gearPath` element
**File:** `zenit-week.html`, function `makeNodeGroup()` around line 2058.

**Action:** Delete these lines (the simple placeholder gear that is created but never appended):
```js
const gearPath = svgEl('path', {
  d: 'M1.5,1.5v3h1v-1h3v-1h-4Z...',
  fill: '#fff',
  transform: 'scale(2) translate(-3, -3)',
  'pointer-events': 'none'
});
```
Only `gearActualPath` is used. `gearPath` is a dead variable.

---

### 11. Fix deprecated `navigator.platform`
**File:** `zenit-week.html`, inside `window.addEventListener('load', ...)` around line 3425.

**Fix:**
```js
// BEFORE:
const isMac = /Mac|iPhone|iPod|iPad/.test(navigator.platform);

// AFTER:
const isMac = navigator.userAgentData?.platform
  ? navigator.userAgentData.platform === 'macOS'
  : /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);
```
**Why:** `navigator.platform` is deprecated and will be removed in future browsers.

---

### 12. Improve `genId()` entropy
**File:** `zenit-week.html`, function `genId()` around line 1625.

**Fix:**
```js
// BEFORE:
function genId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// AFTER:
function genId() {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return 'n' + uuid.slice(0, 12);
}
```
**Why:** The original has ~1.7M combinations of random characters — technically collision-safe for personal use but not production-grade.

---

### 13. Fix hardcoded branch colors in HTML template bypassing the color system
**File:** `zenit-week.html`, around lines 1077–1089.

**Action:** The legend dots in the summary panel use hardcoded `style="background:#A259FF"` etc. These are never updated when a user changes branch colors. They already have `data-branch-dot` attributes — the `updateColorDots()` function handles them correctly, but the inline `style` overrides it.

**Fix:** Remove the inline `style` attribute from each legend dot that has a `data-branch-dot` attribute and instead set their initial color via `updateColorDots()` which is already called on init. Search for all occurrences of `data-branch-dot` in HTML and remove the accompanying `style="background:..."`.

---

## 🔵 Open-Source Infrastructure

### 14. Add `.gitignore`
**File to create:** `.gitignore`
**Content:**
```
.DS_Store
Thumbs.db
*.swp
*.swo
node_modules/
dist/
.env
```

---

### 15. Add `CONTRIBUTING.md`
**File to create:** `CONTRIBUTING.md`
**Action:** Write a short contributing guide covering:
- How to run the project (open HTML in browser, no build step)
- Single-file policy: all code stays in `zenit-week.html`
- Code style: `'use strict'`, `const`/`let`, camelCase functions, kebab-case CSS
- How to test: manual testing in browser, checklist of features to verify
- How to submit a PR: branch naming, PR description expectations
- Link to open issues

---

### 16. Add GitHub Actions workflow for basic validation
**File to create:** `.github/workflows/validate.yml`
**Action:** Create a workflow that runs on every PR and push to main:
```yaml
name: Validate
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check HTML is valid
        run: npx --yes html-validate zenit-week.html
      - name: Check JS has no syntax errors
        run: node --check <(grep -ozP '(?s)(?<=<script>).*(?=</script>)' zenit-week.html)
```
Adjust the JS extraction approach as needed for the actual CI environment.

---

### 17. Add issue and PR templates
**Files to create:**
- `.github/ISSUE_TEMPLATE/bug_report.md` — bug template with browser, OS, steps to reproduce, expected vs actual
- `.github/ISSUE_TEMPLATE/feature_request.md` — feature request template
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist: tested in Chrome, Firefox, Safari; no regressions; single file

---

### 18. Add `CHANGELOG.md`
**File to create:** `CHANGELOG.md`
**Action:** Start with a single `## [Unreleased]` section and the initial `## [1.0.0]` entry listing current features. Follow Keep a Changelog format: https://keepachangelog.com

---

### 19. Add `package.json` for project metadata and scripts
**File to create:** `package.json`
**Action:**
```json
{
  "name": "zenit-week",
  "version": "1.0.0",
  "description": "Zenit Week — a mind-map week planner that runs in your browser with no server required.",
  "homepage": "https://github.com/YOUR_USERNAME/zenit-week",
  "license": "MIT",
  "scripts": {
    "validate": "html-validate zenit-week.html"
  },
  "devDependencies": {
    "html-validate": "^9.0.0"
  }
}
```
Replace `YOUR_USERNAME` with the actual GitHub username.

---

### 20. Add unit tests for data model functions
**File to create:** `tests/data.test.js`
**Action:** Set up Vitest (or Jest) and write unit tests for the pure functions most likely to break. Priority functions to test:
- `getISOWeek()` — test edge cases: Jan 1, Dec 31, week 53 years
- `offsetWeek()` — test wrapping across year boundaries
- `weeksInYear()` — test years with 53 weeks (e.g. 2020, 2026)
- `validateAndRepair()` — test with null, missing nodes array, orphaned children, dangling parent refs
- `transferUnfinished()` — test that only undone non-branch nodes transfer, that `prevId` deduplication works
- `genId()` — test that 1000 generated IDs are all unique

Add a `test` script to `package.json`: `"test": "vitest run"`

---

## Priority Order

If tackling sequentially, do them in this order:

1. LICENSE ← unblocks anyone from using the code
2. README ← makes the project discoverable
3. Fix `validateAndRepair` null return + `_editing` strip ← data integrity
4. Fix silent catch blocks ← debuggability  
5. Fix localStorage quota handling ← data loss prevention
6. Remove `render()` from `resizeInlineInput()` ← performance, easy win
7. Fix `findNode()` with Map ← performance
8. Fix `window resize` reset ← UX annoyance
9. Dead code + deprecated API fixes ← code quality
10. .gitignore + CONTRIBUTING + GitHub templates ← contributor experience
11. CHANGELOG + package.json ← project hygiene
12. GitHub Actions ← automation
13. Unit tests ← long-term stability
14. Gradient caching ← advanced performance

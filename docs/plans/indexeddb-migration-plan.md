# Implementation Plan: IndexedDB Migration + Single-Tab Enforcement

## Overview
Replace localStorage week-data storage with IndexedDB (no practical size limit), migrate existing data transparently on first load, and enforce a single active tab via BroadcastChannel with a "Use here" overtake flow.

Spec: `docs/specs/indexeddb-migration.md`

## Architecture Decisions

- **`loadWeek` becomes async** — all callers (`loadAndRender`, `hashchange`, transfer functions, undo apply) must `await` it. `window.addEventListener('load', ...)` becomes an async callback.
- **`saveWeek` is fire-and-forget at call sites** — internally async; no caller needs to `await` the write (same behaviour as `localStorage.setItem` today).
- **`_nextWeekRawCache`** — `takeSnapshot()` reads next-week raw JSON synchronously. Rather than making it async, we load and cache the adjacent week's raw string at startup and update it in `saveWeek`. Keeps undo stack synchronous.
- **`zenit-week-colors` (branch colors) moves to IDB** — it contains theme/lang duplicated for Drive sync, but theme/lang are still read from localStorage on first paint. The colors file is only accessed in async Drive contexts, so IDB is fine.
- **Settings that stay in localStorage:** `zenit-week-theme`, `zenit-week-lang`, `zenit-week-google-auth`, `zenit-week-view`, `zenit-week-autolayout`, `zenit-week-reset-token`, `zenit-week-had-google-session`, `zenit-week-storage-migrated`.
- **BroadcastChannel graceful degradation** — if `'BroadcastChannel' not in window`, skip tab enforcement entirely; `isActiveTab = true` immediately.

## Dependency Graph

```
Task 1: IDB wrapper (openDB, loadWeekIDB, saveWeekIDB, listWeekKeysIDB, deleteWeekIDB, loadValueIDB, saveValueIDB)
    │
    ├── Task 2: One-time migration (localStorage → IDB)
    │       │
    │       └── Task 3: Async startup (load → await openDB → await migrate → await loadAndRender)
    │               │
    │               ├── Task 4: Rewire loadWeek / saveWeek / takeSnapshot / _applySnapshot
    │               │       │
    │               │       └── Task 5: Drive sync + export (iterate IDB, not localStorage)
    │               │               │
    │               │               └── Task 6: Async callers (transfer fns, undo, deleteWeek, branch-colors)
    │               │
    │               └── Task 7: BroadcastChannel + tab state (runs before loadAndRender)
    │                       │
    │                       ├── Task 8: Stalled overlay UI + i18n
    │                       │
    │                       └── Task 9: Tab ping flow on startup + becomeActive / goStalled
    │
    └── Task 10: Error handling (QuotaExceededError toast, onblocked banner)
            │
            └── Task 11: TODO cleanup comment (2026-07-28)
```

---

## Phase 1: Foundation

### Task 1: IndexedDB wrapper

**Description:** Create a pure IDB abstraction layer — no UI, no side effects. Everything else builds on this. All functions return Promises. DB name `zenit-week-db`, version `1`, object store `weeks` with `weekKey` as keyPath. Separate key-value store `misc` for branch-colors and import-pending.

**Acceptance criteria:**
- [ ] `openDB()` opens (or creates) the DB; returns the IDBDatabase instance; safe to call multiple times (returns cached promise)
- [ ] `loadWeekIDB(wk)` returns parsed weekData or `null`
- [ ] `saveWeekIDB(wk, data)` writes the weekData object
- [ ] `listWeekKeysIDB()` returns `string[]` of all stored week keys
- [ ] `deleteWeekIDB(wk)` removes the week entry
- [ ] `loadValueIDB(key)` / `saveValueIDB(key, value)` / `deleteValueIDB(key)` operate on the `misc` store
- [ ] `onblocked` on the open request calls a stub `onDbBlocked()` (wired in Task 10)
- [ ] All operations wrap IDB request events in a Promise; no raw IDB callbacks leak out

**Verification:**
- [ ] Manual: open DevTools → Application → IndexedDB → `zenit-week-db` appears after first load
- [ ] `npm run validate` passes

**Dependencies:** None

**Files touched:** `zenit-week.html` (new `// ─── IndexedDB ───` section, ~60 lines)

**Scope:** S

---

### Task 2: One-time localStorage→IDB migration

**Description:** On startup, if `zenit-week-storage-migrated` is not set in localStorage, scan all `zenit-week-YYYY-WW` keys plus `zenit-week-colors` and `zenit-week-import-pending`, write them to IDB, then set the flag and delete the localStorage copies.

**Acceptance criteria:**
- [ ] `runMigrationIfNeeded()` is a no-op if `localStorage.getItem('zenit-week-storage-migrated')` is set
- [ ] All `zenit-week-YYYY-WW` keys are copied to IDB `weeks` store
- [ ] `zenit-week-colors` and `zenit-week-import-pending` are copied to IDB `misc` store
- [ ] Migration flag is set **only** after all writes succeed (partial migration retries on next load)
- [ ] localStorage copies of migrated week keys are deleted after successful migration
- [ ] Migration function has a `// TODO: remove after 2026-07-28` comment

**Verification:**
- [ ] Fresh load with pre-existing localStorage data: DevTools shows data in IDB, localStorage week keys gone, flag set
- [ ] Second load: migration function exits immediately (flag is set)
- [ ] `npm run validate` passes

**Dependencies:** Task 1

**Files touched:** `zenit-week.html` (~30 lines)

**Scope:** S

---

### Task 3: Async startup sequence

**Description:** Convert `window.addEventListener('load', ...)` to an async callback. Sequence: `await openDB()` → `await runMigrationIfNeeded()` → `await loadAndRender(initialWeek)`. Add a minimal loading class on `<body>` that hides the SVG canvas until data is ready (~50 ms in practice, invisible to users).

**Acceptance criteria:**
- [ ] `loadAndRender(wk)` is `async`; awaits `loadWeek` before calling `render()`
- [ ] `hashchange` handler is `async`; awaits `loadWeek` before calling `render()`
- [ ] `<body>` has class `app-loading` until first render completes; removed after `render()` returns
- [ ] No `render()` call executes before `openDB()` resolves
- [ ] App still loads and displays data correctly

**Verification:**
- [ ] Hard refresh: app loads, week data renders (from IDB)
- [ ] Navigate to previous week: data loads from IDB
- [ ] `npm test` passes
- [ ] `npm run validate` passes

**Dependencies:** Tasks 1, 2

**Files touched:** `zenit-week.html` (startup block, `loadAndRender`, `hashchange` handler, minor CSS)

**Scope:** M

---

### Checkpoint 1 — Foundation

- [ ] `npm test` passes
- [ ] `npm run validate` passes
- [ ] App loads, displays week data (loaded from IDB after migration)
- [ ] Week navigation works
- [ ] DevTools: week data visible in IndexedDB, not in localStorage

---

## Phase 2: Rewire Core Storage

### Task 4: Replace loadWeek / saveWeek with IDB

**Description:** `loadWeek(wk)` becomes `async` and reads from IDB (including previous-week lookup for branch inheritance). `saveWeek(wk, data)` writes to IDB internally (fire-and-forget for callers). Introduce `let _nextWeekRawCache = null` — loaded at startup alongside current week, updated in `saveWeek` when `wk === nextWeekKey`, used by `takeSnapshot()` (keeps undo stack synchronous). `_applySnapshot()` becomes `async`, uses IDB to restore next-week data.

**Acceptance criteria:**
- [ ] `loadWeek(wk)` reads from IDB; falls through to previous-week branch inheritance via IDB
- [ ] `saveWeek(wk, data)` writes to IDB; `scheduleDriveSync` still called
- [ ] `takeSnapshot()` uses `_nextWeekRawCache` (no signature change; stays synchronous)
- [ ] `_applySnapshot()` is `async`; uses `saveWeekIDB` / `deleteWeekIDB` to restore next-week data
- [ ] No `localStorage.getItem/setItem` calls remain for `storageKey(...)` keys
- [ ] Undo/redo works correctly across week boundaries

**Verification:**
- [ ] Create node → undo → redo: state correct
- [ ] Transfer unfinished from previous week: data appears
- [ ] `npm test` passes

**Dependencies:** Task 3

**Files touched:** `zenit-week.html` (`loadWeek`, `saveWeek`, `takeSnapshot`, `_applySnapshot`, startup block for `_nextWeekRawCache`)

**Scope:** M

---

### Task 5: Drive sync + export functions

**Description:** All Drive sync and export functions that currently iterate or access localStorage week keys must switch to IDB. Specifically: `receiveWeekFromDrive`, `pullWeekFromDrive`, `_uploadWeekToDrive`, `forcePushAllToDrive`, `exportAllData`, `applyDriveImport`, and the `import-pending` flag checks.

**Acceptance criteria:**
- [ ] `receiveWeekFromDrive(wKey, json)` writes merged JSON to IDB
- [ ] `pullWeekFromDrive(wKey)` reads local JSON from IDB
- [ ] `_uploadWeekToDrive(wKey)` reads JSON from IDB via `loadWeekIDB`
- [ ] `forcePushAllToDrive()` uses `listWeekKeysIDB()` to enumerate weeks
- [ ] `exportAllData()` reads week keys from IDB
- [ ] `applyDriveImport()` writes imported week data to IDB
- [ ] `import-pending` flag uses `loadValueIDB` / `saveValueIDB` / `deleteValueIDB`
- [ ] `zenit-week-colors` reads/writes via `loadValueIDB` / `saveValueIDB`
- [ ] No localStorage calls remain for week data or `zenit-week-colors` / `zenit-week-import-pending`

**Verification:**
- [ ] Sign in to Drive: sync completes without errors
- [ ] Export: JSON file contains all week data
- [ ] Import: data restores correctly
- [ ] `npm test` passes

**Dependencies:** Task 4

**Files touched:** `zenit-week.html` (Drive sync section, export/import functions, ~8 call sites)

**Scope:** M

---

### Task 6: Async callers — transfer functions, undo, branch-colors, clear-week

**Description:** All remaining functions that call `loadWeek` or write week data must be made async. Also wire `loadBranchColors` / `saveBranchColors` to IDB.

Functions to update:
- `transferUnfinished()` → `async`, awaits `loadWeek(prevWeekKey)`
- `transferReusable()` → `async`, awaits `loadWeek(prevWeekKey)`
- `moveNodeToNextWeek(nodeId)` → `async`, awaits `loadWeek(nextKey)`
- Clear-week path in `deleteNode` (line 8144) → awaits `deleteWeekIDB`
- `loadBranchColors()` → `async`, reads from IDB `misc` store
- `saveBranchColors()` → writes to IDB `misc` store (fire-and-forget)

**Acceptance criteria:**
- [ ] "Transfer unfinished" moves items from previous week correctly
- [ ] "Transfer reusable" copies reusable items correctly
- [ ] "Move to next week" moves a node correctly
- [ ] "Clear the week" removes week from IDB
- [ ] Branch colors persist across page reloads
- [ ] No remaining `localStorage` calls for any data that belongs in IDB

**Verification:**
- [ ] Manual test each transfer operation
- [ ] Reload after color change: color persists
- [ ] `npm test` passes
- [ ] Grep confirms zero `localStorage` calls for `storageKey`, `zenit-week-colors`, `zenit-week-import-pending`

**Dependencies:** Task 5

**Files touched:** `zenit-week.html` (transfer functions, deleteNode, loadBranchColors, saveBranchColors)

**Scope:** M

---

### Checkpoint 2 — Core Storage Complete

- [ ] `npm test` passes
- [ ] `npm run validate` passes
- [ ] Full smoke test: load → edit → undo → redo → transfer → export → import → Drive sync
- [ ] Zero localStorage calls for week data (verified by grep)
- [ ] Human review before proceeding to tab enforcement

---

## Phase 3: Single-Tab Enforcement

### Task 7: BroadcastChannel setup + tab state

**Description:** Create the tab coordination layer. `initTabChannel()` sets up the BroadcastChannel, registers the message handler, and broadcasts `tab-close` on `beforeunload`. Gracefully skips everything if `BroadcastChannel` is not available.

```javascript
let isActiveTab = false;
const TAB_CHANNEL = 'zenit-week-tab';
```

Message handler:
- `tab-ping` + `isActiveTab` → reply `tab-active`
- `tab-overtake` → call `goStalled()`
- `tab-close` → if stalled, call `becomeActive()`

`goStalled()` and `becomeActive()` are stubbed (wired in Task 9).

**Acceptance criteria:**
- [ ] `initTabChannel()` returns immediately with `isActiveTab = true` if `BroadcastChannel` unavailable
- [ ] Active tab replies to `tab-ping` with `tab-active`
- [ ] Active tab calls `goStalled()` on receiving `tab-overtake`
- [ ] Stalled tab calls `becomeActive()` on receiving `tab-close`
- [ ] `beforeunload` broadcasts `tab-close`

**Verification:**
- [ ] `npm run validate` passes (no syntax errors)

**Dependencies:** Task 3

**Files touched:** `zenit-week.html` (new `// ─── Tab Enforcement ───` section, ~40 lines)

**Scope:** S

---

### Task 8: Stalled overlay UI + i18n

**Description:** Add the full-page stalled overlay HTML and CSS following the `#app-confirm-overlay` pattern. Not dismissible. Single primary button "Use here". Add i18n keys for EN and CS.

HTML structure:
```html
<div id="tab-stalled-overlay">
  <div id="tab-stalled-dialog">
    <div id="tab-stalled-title"></div>
    <div id="tab-stalled-actions">
      <button id="tab-stalled-btn"></button>
    </div>
  </div>
</div>
```

i18n keys to add (both EN and CS TRANSLATIONS objects):
- `tab.useHereTitle` — "App is active in another tab" / "Aplikace je aktivní v jiné záložce"
- `tab.useHereBtn` — "Use here" / "Použít zde"
- `tab.useHerePrompt` — "Use here?" / "Použít zde?"
- `db.upgradeBlocked` — "Please close other tabs to finish updating." / "Zavřete ostatní záložky pro dokončení aktualizace."

**Acceptance criteria:**
- [ ] Overlay is hidden by default
- [ ] When shown, covers full viewport, blocks all interaction (no pointer-events on underlying content)
- [ ] Visually consistent with `#app-confirm-overlay` (same backdrop, dialog shadow, button style)
- [ ] Title and button text populated via `t()` i18n helper
- [ ] All 4 i18n keys present in both EN and CS translation objects
- [ ] `npm run validate` passes

**Verification:**
- [ ] Temporarily force overlay visible: inspect in browser, confirm appearance on mobile viewport
- [ ] `npm run validate` passes

**Dependencies:** Task 7

**Files touched:** `zenit-week.html` (HTML, CSS, TRANSLATIONS)

**Scope:** S

---

### Task 9: Tab ping flow on startup + becomeActive / goStalled

**Description:** Wire the full tab overtake flow. At startup, after `openDB()` but before rendering: broadcast `tab-ping`, wait 300 ms for `tab-active` response. If response received → show stalled overlay (no render). If not → `isActiveTab = true` → proceed to `loadAndRender`. "Use here" button: broadcast `tab-overtake`, re-read IDB, full re-render, become active.

```javascript
async function becomeActive() {
  isActiveTab = true;
  document.getElementById('tab-stalled-overlay').classList.remove('visible');
  weekData = await loadWeek(currentWeekKey);
  rebuildNodeMap(); syncBranchConfig(); render();
}

function goStalled() {
  isActiveTab = false;
  document.getElementById('tab-stalled-overlay').classList.add('visible');
}
```

**Acceptance criteria:**
- [ ] First tab: no overlay shown, app renders normally
- [ ] Second tab opened while first is active: stalled overlay shown immediately, app does not render
- [ ] "Use here" on second tab: second tab renders with fresh IDB data; first tab shows stalled overlay
- [ ] "Use here" on stalled tab: becomes active, re-reads IDB, re-renders
- [ ] Closing active tab (normal close): stalled tab removes overlay and becomes active
- [ ] 300 ms ping timeout: if no other tab, startup proceeds without perceptible delay

**Verification:**
- [ ] Open two browser tabs: confirm overtake flow end-to-end
- [ ] Verify re-render after overtake shows latest data
- [ ] `npm test` passes

**Dependencies:** Tasks 7, 8

**Files touched:** `zenit-week.html` (startup block, `becomeActive`, `goStalled`, `tab-stalled-btn` click handler)

**Scope:** S

---

### Checkpoint 3 — Tab Enforcement Complete

- [ ] `npm test` passes
- [ ] `npm run validate` passes
- [ ] Two-tab overtake flow works end-to-end
- [ ] Single-tab use: no regressions

---

## Phase 4: Polish

### Task 10: Error handling + onblocked banner

**Description:** Wire `onDbBlocked()` from Task 1 to show a non-dismissible banner. Add `QuotaExceededError` catch in `saveWeekIDB` to show a toast warning.

Banner HTML: a simple `#db-blocked-banner` fixed at top of viewport, hidden by default.
```
"Please close other tabs to finish updating. Reload this tab after."
```

**Acceptance criteria:**
- [ ] `saveWeekIDB` catches `QuotaExceededError` (or `DOMException` name check) and shows a visible warning toast — does not silently swallow the error
- [ ] `onDbBlocked()` adds `visible` class to `#db-blocked-banner`
- [ ] Banner is not dismissible
- [ ] `db.upgradeBlocked` i18n key used for banner text
- [ ] `npm run validate` passes

**Verification:**
- [ ] `npm run validate` passes
- [ ] Code review: confirm no swallowed errors in IDB wrapper

**Dependencies:** Tasks 1, 8 (i18n key already added)

**Files touched:** `zenit-week.html` (IDB wrapper error handling, banner HTML + CSS)

**Scope:** XS

---

### Task 11: Cleanup TODO marker

**Description:** Confirm the migration function added in Task 2 has the standard cleanup comment consistent with existing codebase convention.

**Acceptance criteria:**
- [ ] Migration function has `// TODO: remove after 2026-07-28 — localStorage→IDB migration code` comment
- [ ] Comment is on the function definition line (not inside the body)
- [ ] Consistent with existing TODO at line 4920

**Verification:**
- [ ] `grep -n "TODO.*2026-07-28" zenit-week.html` returns two results

**Dependencies:** Task 2

**Files touched:** `zenit-week.html` (1 line)

**Scope:** XS

---

### Checkpoint 4 — Complete

- [ ] `npm test` passes
- [ ] `npm run validate` passes
- [ ] All acceptance criteria from `docs/specs/indexeddb-migration.md` verified
- [ ] Zero `localStorage` calls for week data (grep clean)
- [ ] Manual smoke test: fresh user, returning user, Drive sync, export, import, two tabs

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `loadWeek` async refactor breaks a call site | High | Grep all callers before starting Task 4; verify with `npm test` after each task |
| `takeSnapshot` reads stale `_nextWeekRawCache` | Medium | Update cache in `saveWeek` and on week navigation; test undo across week boundary |
| Drive sync functions have many indirect localStorage paths | Medium | Task 5 is dedicated to this; grep for `storageKey` after completion to confirm zero remaining |
| BroadcastChannel 300 ms timeout adds perceptible delay | Low | 300 ms is imperceptible; if needed, reduce to 150 ms |
| Migration deletes localStorage data before IDB write confirmed | High | Set migration flag only after all IDB writes resolve; idempotent retry on failure |

## Open Questions
- None — all spec questions resolved before planning.

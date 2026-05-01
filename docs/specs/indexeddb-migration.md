# SPEC: IndexedDB Migration + Single-Tab Enforcement

## Problem
localStorage is capped at ~5 MB per origin (Chrome/Safari). At ~40 KB/week today (no comments yet), active users will hit the limit within 1–2 years. The upcoming comments feature accelerates this. Additionally, multiple open tabs can cause silent data loss through concurrent writes.

## Goals
1. Move week data storage from localStorage to IndexedDB (no practical size limit).
2. Keep settings in localStorage (synchronous first-paint access required).
3. Migrate existing localStorage week data transparently on first load.
4. Enforce single active tab via BroadcastChannel — block the UI in inactive tabs with a "Use here" prompt.

## Out of Scope
- `file://` protocol support (dropped — IndexedDB on `file://` is unsupported edge case)
- Auto-recovery when active tab closes without sending a close signal
- Per-week conflict scoping (any two tabs = conflict, regardless of week)
- "No" / dismiss option on the Use Here prompt

---

## Part 1: IndexedDB Storage

### Database Schema

```
DB name:    zenit-week-db
DB version: 1
Store:      weeks
  keyPath:  weekKey        (e.g. "2026-14")
  value:    weekData JSON  (same shape as today)
```

No indexes needed — all access is by exact weekKey.

### What Moves to IndexedDB

| Key pattern | Moves to IndexedDB | Stays in localStorage |
|-------------|-------------------|----------------------|
| `zenit-week-YYYY-WW` | ✓ | |
| `zenit-week-theme` | | ✓ |
| `zenit-week-lang` | | ✓ |
| `zenit-week-google-auth` | | ✓ |
| `zenit-week-branch-colors` | ✓ | |
| `zenit-week-import-pending` | ✓ | |
| `zenit-week-storage-migrated` | | ✓ (migration flag) |

Settings stay in localStorage because they are read synchronously before first render to avoid flash of wrong theme or language.

### Storage API (new internal interface)

```javascript
// Read one week — called at startup and on week navigation
async function loadWeek(weekKey): weekData | null

// Write one week — fire-and-forget at call sites (no await needed)
async function saveWeek(weekKey, data): void

// List all stored week keys — used by transfer/export/Drive seed
async function listWeekKeys(): string[]

// Delete one week
async function deleteWeek(weekKey): void
```

All existing `localStorage.getItem('zenit-week-...')` and `localStorage.setItem(...)` calls for week data are replaced by these functions.

### Startup Sequence Change

Current (sync):
```
1. Read localStorage → render
```

New (async):
```
1. Open IndexedDB (await)
2. Run migration if needed (await)
3. Load week data (await)
4. Render
```

Startup must await DB open and data load before first render. Show a minimal loading state (spinner or blank) during this window — expected < 50 ms in practice.

### Migration (localStorage → IndexedDB)

Runs once on first load after the update. Guarded by `localStorage.getItem('zenit-week-storage-migrated')`.

```
if storage-migrated flag not set:
  scan all localStorage keys matching /^zenit-week-\d{4}-\d{2}$/
  for each key:
    parse JSON value
    write to IndexedDB weeks store
  also migrate: zenit-week-branch-colors, zenit-week-import-pending
  set localStorage flag: zenit-week-storage-migrated = "1"
  delete migrated localStorage week keys
```

If migration fails mid-way (tab closed, error thrown): flag is not set, migration retries on next open. Safe to re-run — writes are idempotent.

**Cleanup:** Remove migration code after `2026-07-28` (all early adopters expected migrated by then — consistent with existing TODO convention in codebase).

### Schema Upgrade Blocking

If IndexedDB is open in another tab during a version upgrade, `onblocked` fires. Show a non-dismissible banner:

> "Please close other tabs to finish updating. Reload this tab after."

This is separate from the multi-tab overtake flow below.

### Error Handling

Wrap all IndexedDB operations. On `QuotaExceededError` (unlikely but possible): show app-level warning toast. On any other open/read/write failure: fall back to in-memory only for the session and show a persistent warning banner — do not silently lose data.

---

## Part 2: Single-Tab Enforcement

### Mechanism: BroadcastChannel

Channel name: `zenit-week-tab`

### Message Types

```javascript
{ type: 'tab-ping' }       // new tab asks: is anyone active?
{ type: 'tab-active' }     // active tab replies: yes, I'm here
{ type: 'tab-overtake' }   // a tab announces it is taking over
{ type: 'tab-close' }      // active tab announces it is closing (beforeunload)
```

### Flow: New Tab Opens

```
1. Tab opens
2. Broadcast tab-ping
3. Listen for tab-active response for 300 ms
   ├── No response → this tab is the active tab → proceed normally
   └── Response received → show blocking "Use here?" overlay
         └── User clicks "Use here" →
               broadcast tab-overtake
               re-read all data from IndexedDB
               full re-render
               become active tab
```

### Flow: Tab Receives tab-overtake

```
1. Receive tab-overtake message
2. Immediately show stalled overlay (full-page, no dismiss)
   Content: "App is active in another tab."
   Button:  [Use here]
3. On "Use here" click →
     broadcast tab-overtake
     re-read all data from IndexedDB
     full re-render
     become active tab
     (previous active tab will receive tab-overtake and go stalled)
```

### Flow: Active Tab Closes

```
beforeunload event → broadcast tab-close
```

Stalled tabs receive `tab-close` and remove their stalled overlay, becoming active. If the active tab crashes without sending `tab-close`, stalled tabs remain stalled until the user clicks "Use here" or refreshes. This is an acceptable edge case.

### Stalled Overlay UI

Full-page overlay, same visual pattern as `#app-confirm-overlay`. Not dismissible.

```
┌─────────────────────────────────┐
│                                 │
│   App is active in another tab  │
│                                 │
│         [ Use here ]            │
│                                 │
└─────────────────────────────────┘
```

"Use here" button styled as primary action (same as confirm dialog OK button).

### Active Tab Responsibility

The active tab must respond to `tab-ping` messages:

```javascript
channel.onmessage = (e) => {
  if (e.data.type === 'tab-ping' && isActiveTab) {
    channel.postMessage({ type: 'tab-active' });
  }
  if (e.data.type === 'tab-overtake') {
    goStalled();
  }
  if (e.data.type === 'tab-close') {
    if (isStalled) becomeActive(); // re-read + re-render
  }
};
```

---

## i18n Keys Required

| Key | EN | CS |
|-----|----|----|
| `tab.useHereTitle` | App is active in another tab | Aplikace je aktivní v jiné záložce |
| `tab.useHereBtn` | Use here | Použít zde |
| `tab.useHerePrompt` | Use here? | Použít zde? |
| `db.upgradeBlocked` | Please close other tabs to finish updating. | Zavřete ostatní záložky pro dokončení aktualizace. |

---

## Acceptance Criteria

### Storage Migration
- [ ] First load after update migrates all `zenit-week-YYYY-WW` keys from localStorage to IndexedDB
- [ ] Migration is idempotent — safe to run twice without data duplication
- [ ] Settings (theme, language, auth) remain in localStorage and are unaffected
- [ ] After migration, week data is no longer read from or written to localStorage
- [ ] localStorage week keys are deleted after successful migration
- [ ] Migration code path removed after `2026-07-28`
- [ ] `QuotaExceededError` shows a user-visible warning (not a silent failure)
- [ ] `onblocked` during schema upgrade shows a non-dismissible banner

### Single-Tab Enforcement
- [ ] Opening a second tab while first is active shows "Use here?" blocking overlay
- [ ] Clicking "Use here" re-reads IndexedDB and re-renders before unblocking
- [ ] The previously active tab goes stalled with full-page overlay on overtake
- [ ] A stalled tab can reclaim active status via "Use here"
- [ ] Active tab closing (normal close) releases stalled tabs automatically
- [ ] BroadcastChannel not supported (old browser) → degrade gracefully, no crash

---

## Not Doing (and Why)
- **`file://` fallback** — unsupported edge case, increases complexity, not a use case we support
- **"No" / Cancel on Use Here prompt** — no valid reason to open the app and not use it; omitting reduces confusion
- **Per-week conflict scoping** — two tabs editing different weeks could theoretically coexist, but detecting and managing this adds significant complexity for a rare scenario
- **Comment history / undo on storage layer** — undo is handled in-memory by the existing undo stack; storage is append-on-save only

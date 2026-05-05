# Spec: UI Layout Reorganization — Corner Declutter

## Objective

Reduce toolbar clutter and improve discoverability by redistributing UI controls to corner positions that match their usage frequency and semantic role.

**Target user:** Solo user of Zenit Week on desktop (personal productivity, week planning).

---

## Problem

Top-right toolbar has 3 unrelated elements: `#sync-dot` (standalone indicator), Google login/avatar, and Settings button. Settings is low-frequency utility mixed with high-frequency identity controls. Undo/Redo are keyboard-only — invisible to casual users. Help FAB occupies bottom-right prime real estate but is rarely needed.

---

## Proposed Layout

```
┌─────────────────────────────────────────────┐
│ [Logo] [Week Nav]          [Sign-in/Avatar●] │  ← top-right: identity + badge
│                                              │
│              [Mind Map / Canvas]             │
│                                              │
│ [←↑ Undo | ↑→ Redo]  [Agenda | Mindmap]  [⚙] │  ← bottom row
└─────────────────────────────────────────────┘
  bottom-left    bottom-center      bottom-right
```

---

## Changes

### 1. Top-right: Badge on avatar/sign-in button replaces `#sync-dot`

**HTML:**
- Remove `<div id="sync-dot" ...></div>` from `#toolbar-right`.
- Remove `#settings-container` (Settings button + dropdown) from `#toolbar-right`.
- Add `<div id="sync-badge"></div>` inside `#sync-container`. Position it absolutely so it overlays the currently-visible button's bottom-right corner (either `#sync-btn` or `#sync-avatar-btn`).

`#sync-container` already wraps both buttons — `position: relative` on it is sufficient for absolute child positioning.

**CSS (new — replaces `#sync-dot` block):**
```css
#sync-badge {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #aaaaaa;
  border: 2px solid var(--toolbar-bg, var(--bg-app));
  pointer-events: none;
  transition: background 0.3s;
  z-index: 1;
}

#sync-badge[data-status="connected"] { background: #34a853; }
#sync-badge[data-status="syncing"]   { background: #fbbc04; animation: sync-pulse 1s ease-in-out infinite; }
#sync-badge[data-status="error"]     { background: #ea4335; }
```
`sync-pulse` keyframes already exist — reuse without change.

**CSS (remove):** Delete `#sync-dot { ... }` block and its `[data-status]` variant rules.

**JS (`setSyncStatus`):** Change element lookup from `'sync-dot'` → `'sync-badge'`. No other logic changes.

---

### 2. Bottom-right: Replace `#help-fab` with `#settings-fab`

**HTML:** Replace:
```html
<div id="help-fab" ...><svg ...><use href="#icon-help-circle"/></svg></div>
```
with:
```html
<button id="settings-fab" data-i18n-title="toolbar.settings" title="Settings" aria-haspopup="true">
  <svg class="icon" aria-hidden="true"><use href="#icon-settings"/></svg>
</button>
```

Move `#settings-dropdown` element out of the old `#settings-container` in the toolbar and place it as a sibling of `#settings-fab`, near the end of `#app`.

**CSS:** Rename CSS selector `#help-fab` → `#settings-fab` (same 44×44 glass style, same position `bottom:12px; right:12px`). Add dropdown positioning:
```css
#settings-dropdown {
  position: fixed;
  bottom: 56px;
  right: 12px;
  top: auto;   /* override any previous top-anchored rule */
}
```

**JS:** Remove old `settingsBtn` / click-outside listeners. Add new listeners on `#settings-fab`:
```js
const settingsFab = document.getElementById('settings-fab');
const settingsDropdown = document.getElementById('settings-dropdown');

settingsFab.addEventListener('click', (e) => {
  e.stopPropagation();
  const isVisible = settingsDropdown.classList.toggle('visible');
  settingsFab.classList.toggle('active', isVisible);
});

document.addEventListener('click', (e) => {
  if (!settingsDropdown.contains(e.target) && e.target !== settingsFab) {
    settingsDropdown.classList.remove('visible');
    settingsFab.classList.remove('active');
  }
});
```

Remove old `#help-fab` click listener.

---

### 3. Settings dropdown: Add "Help & Hotkeys" entry

Insert before the Data section (before the last separator + Data `settings-section`):

**HTML:**
```html
<div class="settings-separator"></div>
<div class="settings-section">
  <button class="agenda-action-btn" id="settings-help-btn" data-i18n="help.fab">Help &amp; Hotkeys</button>
</div>
```

**JS:** Wire `#settings-help-btn` to trigger the same action as the old `#help-fab` click (opens help panel). Close `#settings-dropdown` after click.

**i18n:** Keys `help.fab` (EN: `"Help & Hotkeys"`, CS: `"Nápověda & klávesové zkratky"`) already exist — no new keys needed.

---

### 4. Bottom-left: New `#undo-redo-bar` pill

**SVG symbols** — add to the existing `<svg>` sprite:
```html
<symbol id="icon-arrow-back-up" viewBox="0 0 24 24">
  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
  <path d="M9 14l-4 -4l4 -4"/>
  <path d="M5 10h11a4 4 0 1 1 0 8h-1"/>
</symbol>
<symbol id="icon-arrow-forward-up" viewBox="0 0 24 24">
  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
  <path d="M15 14l4 -4l-4 -4"/>
  <path d="M19 10h-11a4 4 0 1 0 0 8h1"/>
</symbol>
```
(Source: tabler.io, outline variant, viewBox 0 0 24 24, `stroke="currentColor"` inherited.)

**HTML** (sibling of `#view-toggle-bar`, near end of `#app`):
```html
<div id="undo-redo-bar">
  <button class="undo-redo-btn" id="undo-btn" data-i18n-title="help.undo" title="Undo" disabled>
    <svg class="icon" aria-hidden="true"><use href="#icon-arrow-back-up"/></svg>
  </button>
  <div class="undo-redo-separator"></div>
  <button class="undo-redo-btn" id="redo-btn" data-i18n-title="help.redo" title="Redo" disabled>
    <svg class="icon" aria-hidden="true"><use href="#icon-arrow-forward-up"/></svg>
  </button>
</div>
```

**CSS:**
```css
#undo-redo-bar {
  position: fixed;
  bottom: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: 0 2px 8px var(--shadow-md);
  padding: 3px;
  z-index: 2500;
  user-select: none;
}

.undo-redo-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  color: var(--text-subtle);
  border: none;
  background: none;
  outline: none;
}

.undo-redo-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-dim);
}

.undo-redo-btn:disabled {
  opacity: 0.35;
  cursor: default;
  pointer-events: none;
}

.undo-redo-separator {
  width: 1px;
  height: 22px;
  background: var(--view-separator);
  margin: 0;
}
```

**JS:** Add helper and call it wherever stack changes:
```js
function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}
```

Call `updateUndoRedoButtons()` at the end of: `undo()`, `redo()`, `pushHistory()`, and once on init (after DOM is ready).

Wire clicks:
```js
document.getElementById('undo-btn').addEventListener('click', () => undo());
document.getElementById('redo-btn').addEventListener('click', () => redo());
```

---

## Acceptance Criteria

- [ ] Top-right toolbar shows only Google sign-in button or avatar — no standalone dot, no Settings button
- [ ] Sync badge (9px dot) overlays the bottom-right corner of whichever button is visible (`#sync-btn` or `#sync-avatar-btn`)
- [ ] `setSyncStatus()` drives badge color for all 4 statuses: disconnected (grey), connected (green), syncing (yellow, pulsing), error (red)
- [ ] Settings FAB appears bottom-right (44×44, same glass style as old Help FAB)
- [ ] Settings dropdown opens above the FAB; contains all existing settings in original order
- [ ] "Help & Hotkeys" button in Settings dropdown opens the help panel and closes the dropdown
- [ ] Old `#help-fab` and `#settings-btn` (toolbar) are removed from DOM
- [ ] Undo/Redo pill appears bottom-left; glass style matches `#view-toggle-bar`
- [ ] Undo button disabled when `undoStack` is empty; Redo disabled when `redoStack` is empty
- [ ] Clicking Undo/Redo triggers the same behavior as `Ctrl+Z` / `Ctrl+Shift+Z`
- [ ] Keyboard shortcuts `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y` still work unchanged
- [ ] Light and dark themes look correct for all new elements
- [ ] `#view-toggle-bar` (bottom-center) is unaffected

---

## Not Doing

- **Onboarding / Help discoverability** — separate iteration
- **Mobile-specific layout changes** — beyond what naturally follows from above
- **Help panel content** — untouched
- **Settings dropdown animation** — keep existing `.visible` toggle

---

## Constraints

- All changes in `zenit-week.html` (single-file policy)
- No `innerHTML` with user-controlled strings; static SVG sprite content is acceptable
- `sync-pulse` keyframe animation reused as-is
- `setSyncStatus()` requires only the element-ID change — all call sites untouched
- `genId()` not needed (no new data nodes)

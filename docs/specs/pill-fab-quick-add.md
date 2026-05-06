# Spec: Pill FAB + Quick-Add Inbox

## Objective

Replace the single `#settings-fab` button in the bottom-right corner with a pill-shaped FAB containing two actions: **Settings** (left) and **Add** (right). Tapping **Add** opens a quick-add input that creates an `inbox` node routed to a branch. Target users: primarily mobile users capturing ideas on the go; also available on desktop.

---

## 1. Pill FAB

### Layout
- Single `#fab-pill` container replaces `#settings-fab` entirely
- `position: fixed; bottom: 12px; right: 12px`
- Pill shape: `border-radius: 22px` (fully rounded ends)
- Two buttons inside: `#fab-settings` (left) and `#fab-add` (right)
- Each button: 44×44px tap target, icon centered
- Divider line between them (1px, `var(--border-subtle)`)
- Same glass/blur visual treatment as current settings FAB:
  `background: var(--glass-bg); backdrop-filter: blur(8px); border: 1px solid var(--border-subtle); box-shadow: 0 2px 8px var(--shadow-md)`

### Icons
- Settings: `#icon-settings` (existing)
- Add: `#icon-plus` (existing, Tabler `plus`)

### Behavior
- `#fab-settings` click → same behavior as current `#settings-fab` (toggle `#settings-dropdown`, manage `.active` class)
- `#fab-add` click → open quick-add input (see §2)
- `aria-label="Settings"` on `#fab-settings`, `aria-label="Quick add"` on `#fab-add`

### DOM change
Replace:
```html
<button type="button" id="settings-fab" ...>
  <svg ...><use href="#icon-settings"/></svg>
</button>
```
With:
```html
<div id="fab-pill">
  <button type="button" id="fab-settings" ...>
    <svg ...><use href="#icon-settings"/></svg>
  </button>
  <div class="fab-divider"></div>
  <button type="button" id="fab-add" aria-label="Quick add">
    <svg ...><use href="#icon-plus"/></svg>
  </button>
</div>
```

### JS change
All existing references to `#settings-fab` (event listeners, `.active` class management, dropdown positioning) point to `#fab-settings` instead.

---

## 2. Quick-Add Input

### Two layouts

**Mobile** (`(pointer: coarse)` media query OR `window.innerWidth < 640`):
- `#quick-add-panel`: `position: fixed; bottom: 0; left: 0; right: 0`
- Slides up via `transform: translateY(100%)` → `translateY(0)`, `transition: transform 0.25s ease`
- Input sits above the system keyboard (browser handles this naturally with `position: fixed` at bottom)
- Rounded top corners only: `border-radius: 16px 16px 0 0`
- `padding-bottom: env(safe-area-inset-bottom)` for iPhone notch safety

**Desktop** (`(pointer: fine)` OR `window.innerWidth >= 640`):
- Same `#quick-add-panel`: `position: fixed; bottom: 68px; right: 12px`
- Small floating card: `border-radius: 12px`, `width: 320px`
- Appears above the pill FAB
- Same glass/blur treatment

A single `#quick-add-panel` element is used. A `is-mobile` class toggles the two layout modes.

### Inner structure
```
┌─────────────────────────────────────┐
│  [Work ▾]   (branch picker)          │
├─────────────────────────────────────┤
│  [Type a task...              ] [→]  │
└─────────────────────────────────────┘
```

**Branch picker**
- `<button id="quick-add-branch-btn">` shows selected branch name + caret-down icon
- Opens `#quick-add-branch-dropdown`: a list of all branches from `weekData.nodes.filter(n => n.type === 'branch')`
- Default: first branch, or last-used branch stored in `localStorage` as `zenit-week-quick-add-branch`
- Dropdown appears above the picker button (not below — panel is at bottom of screen)
- Selecting a branch closes the dropdown and updates the button label

**Text input**
- `<input type="text" id="quick-add-input" autocomplete="off">`
- Autofocus on `openQuickAdd()` via `el.focus()`
- `placeholder` → `t('quick_add.placeholder')`
- Max 200 chars (consistent with `validateAndRepair` label sanitization)
- Enter key → submit (if non-empty)
- Esc → close without creating

**Submit button**
- `<button id="quick-add-submit">` with `#icon-plus` or arrow icon
- `disabled` when input is empty (enforced via `input` event listener)

### Open / close
- `openQuickAdd()`: add `is-open` class to panel, call `input.focus()`, add Esc keydown + backdrop click listeners
- `closeQuickAdd()`: remove `is-open` class (reverse slide animation), remove listeners
- Clicking the backdrop (outside the panel) closes without creating
- Successful submit creates node then calls `closeQuickAdd()`

---

## 3. Inbox Node Creation

### `createInboxNode(label, branchId)`
```js
const node = {
  id:        genId(),
  type:      'activity',
  label:     label.trim().slice(0, 200),
  parent:    branchId,
  branch:    branchId,
  children:  [],
  inbox:     true,
  done:      false,
  unplanned: false,
  priority:  'normal',
  reusable:  false,
  offX: 0, offY: 0,
  _ts: Date.now()
};
weekData.nodes.push(node);
findNode(branchId).children.push(node.id);
saveData();
render();
```

### `validateAndRepair` change
In the per-node sanitization pass, add:
```js
if (n.inbox !== undefined) n.inbox = !!n.inbox;
```
Inbox nodes are regular children of a branch node, so they are reachable from roots and survive GC without further changes.

---

## 4. Inbox Node Rendering

### Layout (`computeLayout`)
Inbox nodes are included in normal recursive layout but sorted to the **end** of their parent's children during layout — after all non-inbox siblings — regardless of `children` array insertion order.

In `calcHeight` / the child-placement loop: filter or sort the `activeChildren` array so `inbox === true` nodes come last.

### Visual
- **No bezier connection line**: in the bezier-drawing loop, skip nodes where `node.inbox === true`
- **Muted appearance**: set `opacity="0.55"` on the node's SVG group element
- Node is otherwise fully interactive (rename, delete, done, drag, context menu)

### Drag promotes inbox to permanent
In the REBINDING block of the drag-end handler (around line 9638 in current code), immediately after setting `node.parent = targetParentId`, add:
```js
delete node.inbox;
```
This promotes the node to a permanent map node; it renders at full opacity with a bezier on the next `render()`.

---

## 5. Translations

Add to both `TRANSLATIONS.en` and `TRANSLATIONS.cs`:

```js
// EN
'quick_add.placeholder':  'Add a task…',
'quick_add.submit':       'Add',
'quick_add.branch_label': 'Branch',

// CS
'quick_add.placeholder':  'Přidat úkol…',
'quick_add.submit':       'Přidat',
'quick_add.branch_label': 'Větev',
```

---

## 6. Acceptance Criteria

- [ ] Pill FAB renders at bottom-right; glass/blur style matches app
- [ ] Settings button in pill behaves identically to old `#settings-fab`
- [ ] `#settings-dropdown` still opens/positions correctly relative to `#fab-settings`
- [ ] Tapping "+" on mobile: slide-up panel appears from bottom, input auto-focused
- [ ] Tapping "+" on desktop: popup appears above pill, input auto-focused
- [ ] Branch dropdown lists all current branches; remembers last selection across sessions
- [ ] Submitting creates an `inbox: true` activity node under the selected branch
- [ ] Inbox node appears on the map: after non-inbox siblings, at 55% opacity, no bezier line
- [ ] Inbox node persists across page reload
- [ ] Inbox node survives `validateAndRepair` (not GC'd)
- [ ] Dragging inbox node onto another node clears `inbox` flag; node renders at full opacity with bezier
- [ ] Esc closes quick-add without creating a node
- [ ] Clicking outside the panel closes without creating
- [ ] Empty input cannot be submitted (submit button disabled)
- [ ] All strings go through `t()`; both EN and CS have translations
- [ ] No `innerHTML` with user-controlled data; labels use `textContent`
- [ ] `npm test` passes; `npm run validate` passes

---

## 7. Out of Scope

- Counter (`Nx`) node creation via quick-add
- Day scheduling from quick-add
- Unplanned auto-flag on inbox nodes
- Batch/multi-add
- `#branch` text-routing syntax parsed from the label
- Any new drag system behavior
- Inbox node visual badge or tray icon

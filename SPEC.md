# SPEC: Track A — Day-Leaf Children

**Status**: Ready for implementation  
**Prerequisite for**: Track B (Agenda), Track C (Mindmap Day Filter)  
**Source doc**: `docs/ideas/agenda-and-day-filter.md`

---

## 1. Objective

Replace the current day-selector counter pattern with explicit day-leaf activity nodes.

**Before**: `"Running (mo, we, fr)"` → parent activity + one counter child (`max=3`)  
**After**: `"Running (mo, we, fr)"` → parent `"Running"` + three activity children `"Mo"`, `"We"`, `"Fr"`

Each day-child is an independent activity with its own done/unplanned state. When all day-children are done, the parent auto-marks done via existing cascade behaviour.

Non-day counters (`"Reading 3x"`) are unchanged.

---

## 2. Acceptance Criteria

- [ ] Typing `"Running (mo, we, fr)"` and pressing Enter creates parent `"Running"` with children `"Mo"`, `"We"`, `"Fr"` (activity nodes, `dayChild: true`)
- [ ] `"Duolingo (daily)"` creates parent + 7 day-children in language-canonical order
- [ ] `(day)` groups are stripped from the parent label; other `(...)` groups are preserved
- [ ] Committing `"Running (mo, fr)"` on an existing "Running" node that already has `"Mo"` → appends `"Fr"` child only; `"Mo"` and its state are untouched
- [ ] A single day indicator `"Running (mo)"`: treated as a schedule hint only — no day-children, no counter created, label unchanged
- [ ] Nx pattern and 2+ day indicators in same label: day wins; both stripped; no counter created; `"Pushups 10x (mo)"` (only 1 day) → counter created (Nx wins)
- [ ] Day-child renamed to a canonical day token (e.g. `"We"` → `"Fr"`): label and `dayIndex` both update
- [ ] Day-child renamed to an invalid (non-day) string: label silently reverts to previous value; `dayIndex` unchanged
- [ ] Tab on a day-child node is blocked (no children allowed)
- [ ] "Add child" in context menu is hidden for day-child nodes
- [ ] Todo panel shows day-children as `"Running · Mo"` (parent label · day label)
- [ ] `transferUnfinished`: incomplete day-children carry over like any other activity
- [ ] `transferReusable`: day-children of reusable parents carry over with `done: false` reset
- [ ] Auto-migration: existing counter+day nodes in localStorage are converted on `loadWeek()` — counter removed, day-children created, parent label stripped
- [ ] `validateAndRepair` accepts `dayChild` and `dayIndex` fields as valid without stripping them

---

## 3. Data Model

### New fields on day-child nodes

```javascript
{
  id,
  type: 'activity',      // no new type — reuse existing
  dayChild: true,        // distinguishes day-leaves from regular activities
  dayIndex: Number,      // 0=Sun, 1=Mon … 6=Sat; null if renamed to non-day label
  branch,
  parent,                // id of parent activity
  label,                 // canonical: 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su' / 'Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'
  done,
  unplanned,
  children: [],          // always empty — day-children are leaf nodes
  _ts
}
```

No changes to parent activity nodes beyond having day-child nodes as children.

### Canonical day labels

```javascript
const DAY_LABELS = {
  en: { 1:'Mo', 2:'Tu', 3:'We', 4:'Th', 5:'Fr', 6:'Sa', 0:'Su' },
  cs: { 1:'Po', 2:'Út', 3:'St', 4:'Čt', 5:'Pá', 6:'So', 0:'Ne' },
};
```

Child label = `DAY_LABELS[currentLang][dayIndex]`, falling back to `DAY_LABELS.en[dayIndex]`.

---

## 4. Behaviour Specification

### 4.1 Day-pattern parsing on `commitEdit`

Fires on every label commit (both new node creation and rename), **except** when the node being committed has `dayChild: true` (day-leaves do not expand recursively).

Steps:

1. Call `parseTodoDays(label)` → `Set<dayIndex>`
2. If set has fewer than 2 members → existing Nx/counter logic unchanged (a single day indicator is a schedule hint; `(daily)` produces 7 members and is always ≥ 2)
3. If set has 2 or more members:
   a. Check if label also contains an Nx pattern → ignore Nx; day wins
   b. Strip all day-pattern `(...)` groups from label using `stripDayGroups(label)`
   c. Strip any remaining Nx pattern (`/\s*\d+x\b/i`) from label when day wins
   d. Trim result → set as parent node label
   e. Collect existing day-children: `node.children.map(findNode).filter(n => n?.dayChild)`
   f. Build set of existing `dayIndex` values from those children
   g. For each `dayIndex` in parsed set not already in existing set → call `createDayChild(nodeId, dayIndex)`
   h. Sort all day-children in `parent.children` by ISO week order: Mon(1) … Sat(6) … Sun(0); non-day children sort before day-children; `dayIndex: null` nodes sort last among day-children
   i. Remove any counter child that existed (day replaces counter — should not coexist)

### 4.2 `stripDayGroups(label)` — new helper

Strips only `(...)` groups that are valid day-pattern groups (all tokens are day abbreviations, or it is a daily indicator). Non-day groups like `"(v3)"` are preserved.

```javascript
function stripDayGroups(label) {
  return label.replace(/\s*\([^)]+\)/g, match => {
    const inner = match.slice(match.indexOf('(') + 1, -1).trim();
    const tokens = inner.split(/[\s,]+/).map(t => t.toLowerCase()).filter(Boolean);
    if (!tokens.length) return match;
    if (tokens.length === 1 && SCHED_DAILY_TOKENS.has(tokens[0])) return '';
    if (tokens.every(t => t in SCHED_TOKEN_MAP)) return '';
    return match;
  }).trim();
}
```

### 4.3 `createDayChild(parentId, dayIndex)` — new helper

```javascript
function createDayChild(parentId, dayIndex) {
  const parent = findNode(parentId);
  const label = (DAY_LABELS[currentLang] ?? DAY_LABELS.en)[dayIndex];
  const id = genId();
  const node = {
    id, type: 'activity', dayChild: true, dayIndex,
    branch: parent.branch, parent: parentId,
    label, done: false, unplanned: parent.unplanned || false,
    children: [], _ts: Date.now(),
  };
  weekData.nodes.push(node);
  parent.children.push(id);
  rebuildNodeMap();
  return id;
}
```

### 4.4 Renaming a day-child

On `commitEdit` when `node.dayChild === true`:

- New label matches any token in `SCHED_TOKEN_MAP` (case-insensitive) → resolve `dayIndex` from token, set canonical label via `DAY_LABELS`, update `node.dayIndex`
- New label does not match → plain rename, set `node.dayIndex = null`
- No day-expansion is attempted (day-children are leaves)

### 4.5 Blocking children on day-leaves

- `startAddNode(id)`: guard — if `findNode(id)?.dayChild` → no-op
- Context menu: hide "Add child" (`ctx-add-child`) when `contextTarget` node has `dayChild: true`
- Keyboard `Tab`: same guard as `startAddNode`

### 4.6 Todo panel

When rendering a Todo entry for a `dayChild: true` node, display as:

```
"<parentLabel> · <nodeLabel>"   // e.g.  "Running · Mo"
```

Fetch parent label via `findNode(node.parent)?.label`.

### 4.7 `transferUnfinished`

No logic change needed — day-children are activities; the existing filter `!n.done && n.type !== 'branch'` already includes them. Day-children with `done: false` transfer; their parent also transfers (it will be `!done` if any child is undone).

After transfer, ensure `dayChild` and `dayIndex` fields are preserved (they are copied via `...c` spread — verify no field is stripped).

### 4.8 `transferReusable`

**Change required** in `candidateIds` filter:

```javascript
// Before
n.type === 'counter' && reusableIds.has(n.parent)

// After (replace the counter clause)
(n.type === 'counter' && reusableIds.has(n.parent)) ||
(n.dayChild === true && reusableIds.has(n.parent))
```

**Change required** in the reset block (currently resets counter `val`/`ticks`):

```javascript
if (newNode.type === 'counter') { newNode.val = 0; newNode.ticks = []; }
if (newNode.dayChild)           { newNode.done = false; delete newNode.doneAt; }
```

---

## 5. Migration

### Target: existing counter+day nodes in localStorage

Existing structure to detect: activity node whose label contains day-pattern groups AND has a counter child.

### Location

Called inside `loadWeek()` before the data object is returned/used. Runs every load; idempotent (nodes already migrated lack the counter+day combination).

```javascript
// TODO: remove after 2026-07-28 — all early adopters expected migrated by then
function migrateDayCounters(data) { ... }
```

### Logic

For each activity node in `data.nodes`:

1. Skip if `node.dayChild` (already migrated leaf)
2. Parse `parseTodoDays(node.label)` → if empty, skip
3. Find counter child: `node.children` → find node with `type === 'counter'`
4. If no counter child, skip (already migrated or manually structured)
5. Remove counter child id from `node.children`; remove counter node from `data.nodes`
6. Strip day groups from `node.label` via `stripDayGroups`
7. For each `dayIndex` in parsed days → create day-child node inline (append to `data.nodes`, push id to `node.children`)
8. Day-children start with `done: false` — individual day state is unknown from old counter `val`

Note: counter `val` tells how many ticks occurred but not which days. State is not recoverable. All day-children start undone; parent `done` is reset to `false` if it was `true` from the counter.

### `validateAndRepair`

Add `'dayChild'` and `'dayIndex'` to the set of recognised/preserved fields so they are not stripped from nodes during garbage collection.

---

## 6. Out of Scope for Track A

- Visual styling differentiation for day-child nodes (Track B/C)
- Hotkey day-assignment from canvas / mindmap filter (Track C)
- Agenda panel (Track B)
- Handling of `dayIndex: null` nodes in Agenda (Track B)
- `"Running 3x (mo, fr)"` semantic analysis — see `docs/ideas/agenda-and-day-filter.md` F1

---

## 7. Testing Strategy

Extend the existing vitest suite (`npm test`). No new test files — add cases to relevant existing test groups.

### Unit tests

| Case | Expected |
|------|----------|
| `parseTodoDays('"Running (mo, we, fr)"')` | `Set {1, 3, 5}` |
| `parseTodoDays('"Duolingo (daily)"')` | `Set {0,1,2,3,4,5,6}` |
| `stripDayGroups('"Running (mo, fr)"')` | `"Running"` |
| `stripDayGroups('"Sprint (v3) (mo)"')` | `"Sprint (v3)"` |
| `stripDayGroups('"No groups"')` | `"No groups"` |
| `commitEdit` on new node `"Running (mo, fr)"` | parent label `"Running"`, two day-children `Mo`/`Fr`, `dayChild:true`, `dayIndex` correct |
| `commitEdit` on `"Running"` (existing, already has `Mo`) → label `"Running (mo, fr)"` | appends `Fr` only; `Mo` state unchanged |
| `commitEdit` on `"Pushups 10x (mo)"` | 1 day indicator → Nx wins; counter max=10 created; label unchanged |
| `commitEdit` on `"Running (mo)"` | 1 day indicator → schedule hint only; no day-children, no counter |
| `commitEdit` on `"Pushups 10x"` | counter created as before |
| Rename day-child `"Mo"` → `"Fr"` | `label:'Fr'`, `dayIndex:5` |
| Rename day-child `"Mo"` → `"Morning run"` | label reverts to `'Mo'`; `dayIndex` unchanged |
| `migrateDayCounters`: activity with `(mo, fr)` + counter | counter removed, `Mo`/`Fr` children created, label stripped |
| `migrateDayCounters`: activity already migrated (no counter child) | no change |
| `transferReusable` with reusable parent having day-children | day-children carried over with `done:false` |

### Manual verification

- Open app, type `"Running (mo, we, fr)"`, press Enter → mindmap shows Running + Mo/We/Fr children
- Mark Mo done → Running not done; mark We + Fr done → Running auto-done
- Rename Running → `"Running (daily)"` → Tu/Th/Sa/Su appended, Mo/We/Fr untouched
- Delete We child manually → works; Running has 6 children
- Undo works across all above operations
- Refresh page → state persists
- Drive sync round-trip → `dayChild`/`dayIndex` fields survive JSON serialisation

---

## 8. Boundaries

| Always do | Ask first | Never do |
|-----------|-----------|----------|
| Keep everything in `zenit-week.html` | Any change to Drive sync merge logic | Split into separate files |
| Use `genId()` for all new node ids | Changing `NODE_STYLE` for day-children (Track B/C concern) | Use `crypto.randomUUID()` directly |
| Use `textContent` / DOM construction — no `innerHTML` with user data | | Add new `type` value to `VALID_TYPES` |
| Mark migration code with TODO deletion date (2026-07-28) | | Remove migration code before that date |
| Keep Nx counter behaviour unchanged for non-day labels | | |

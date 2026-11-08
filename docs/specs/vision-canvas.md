# SPEC - Vision Canvas

> Source idea: `docs/ideas/vision-canvas.md`
> Branch: `vision-canvas` (worktree `../zenit-week-vision-canvas`, off `main` at `5f75429`)
> Scope: a second map record, a fourth top-level view, and the agent surface for it. Touches storage, Drive sync, undo, the renderer's write paths, the context menu, hotkeys, both languages and the MCP server.

---

## 1. Objective

Give the user one place inside Zenit Week to draw the long view - a mind map of where they want their life to go and why - and make that map readable by the agent, so that planning a week can be checked against it.

The week stays the only place where things get done. The Vision Canvas is a map of intentions: branches are life areas, nodes are intentions, comments carry the meaning. It has no days, no repetitions, no done.

**Target user:** the existing single user. Writes the vision rarely and at length (many comments, a wide map), reads it when planning a week, and lets the agent read it to propose what the coming weeks should carry.

**Success:** the Vision is one keystroke away from any week, is edited with exactly the gestures the week map already teaches, survives sign-in on a second device byte for byte, and appears to the agent as one resource it can read before proposing tasks.

### Non-goals

| # | Excluded | Why |
|---|---|---|
| 1 | Several canvases | A picker, a Drive file per canvas and a delete flow, before one canvas has been lived with. Branches as areas cover "one per area" now. |
| 2 | Linking a week task to a vision node (`vision: nodeId`) | Near future, not v1. The agent reasons over both records first; the field comes when we know what the link should mean. |
| 3 | Progress, percentages, "last served" rings | Progress is the week's job. Needs the link anyway. |
| 4 | A separate editor or layout engine | The renderer is reused whole. The Vision adds vocabulary, never a second map engine. |
| 5 | Vision in Stats, Agenda, Transfer, Send to the Future | None of them has a meaning for an intention. The Vision is invisible to all four. |
| 6 | A reading pane | Removed after review (2026-11-08). An intention's "why" is its ordinary comment: the comment indicator and the context-menu Comment item open the one comment editor, as on a week. |
| 7 | Mobile view toggle redesign | Four icon buttons fit the bar at its mobile width. Anything further is a later pass. |

---

## 2. Data model

### 2.1 The vision record

A second record, in the IDB `misc` store under `vision`, exactly as the `schedule` record sits there. It is **shaped like a week record** so that every function that reads a week record can read it:

```
vision = {
  nodes: [ ...week-shaped nodes... ],
  tombstones: [],        // deleted node ids, as a week's
  crdtVersion: 0,
  savedAt,               // epoch ms, as a week's
}
```

Nodes carry the week's node shape with the fields below. Everything not listed here is **never set** on a vision node and is stripped by `validateAndRepairVision` (section 2.3).

| # | Field | Role on the Vision |
|---|---|---|
| 1 | `id`, `type`, `branch`, `label`, `parent`, `children` | As on a week. `type` is `branch` or `activity`; an activity here is an intention. The type name is kept so the renderer, `findNode`, `rebuildNodeMap`, drag and the context menu need no second vocabulary. |
| 2 | `priority` | As on a week: how much this matters. Drives the layout scale exactly as today. |
| 3 | `comments` | As on a week. The same grammar, the same editor, the same `tokenizeComment`. On the Vision it is the body of the node, not a side note. |
| 4 | `dropped`, `droppedAt` | **Let go.** An intention the user has consciously given up without erasing it. Reuses the Dropped mechanism whole: cascade, `syncStatusUp`, the 45% opacity, the slash and the badge. The context menu and the toast call it *Let go* (section 5). |
| 5 | `horizon` | New, optional. One of `year`, `years`, `someday`, or absent. A time tag, not a status. Rendered as a badge icon (section 4.3a, row 5); a sub-intention without its own inherits its parent's for filtering. |
| 6 | `collapsed` | New, optional, layout only (`touchLayout`, section 3.5). Children are not drawn; the node carries a count badge. |
| 7 | `offX`, `offY`, `side`, `_ts`, `_posTs` | As on a week. `mergeWeekData` handles them unchanged. |

**Never on a vision node:** `done`, `doneAt`, `unplanned`, `unplannedAt`, `reusable`, `dayChild`, `dayIndex`, `tickChild`, `tickIndex`, `val`, `max`, `ticks`, `schedId`, `schedDate`, `_demo`.

**Invariants**

| # | Rule |
|---|---|
| V1 | The vision record is a valid input to `mergeWeekData`, `rebuildNodeMap`, `syncBranchConfig`, `computeLayout`, `render`, `updateNodeUI` and `takeSnapshot` without a `kind` check inside any of them. Where those functions look at week-only fields (`done`, day leaves, ticks) they find them absent and draw an open, leafless node, which is the correct picture. |
| V2 | `dropped` and `horizon` are independent. A let-go intention keeps its horizon. |
| V3 | `collapsed` is a layout fact. It never bumps `_ts`, never promotes the node's content on merge, and is read from the higher `_posTs` like `offX`. |
| V4 | Branch ids on the Vision are `genId()` UUIDs. They never equal a week's branch id, so `BRANCH_COLORS` and `BRANCH_CONFIG` (global, keyed by branch id) hold the Vision's branches beside the week's with no namespace. |
| V5 | The record has no center node; the center is virtual as on a week. Its label is `t('vision.center')`, never persisted. |

### 2.2 First open - seeding the areas

The first time the Vision is opened on a device and no record exists locally **and** none comes back from Drive (section 3.4 waits for that answer before seeding), the Vision is seeded with **the branches of the week in view**: one vision branch per week branch, same label, same side, a copy of its palette under the new UUID. No activities are copied. This is the only seed; a user who deletes every branch but one has a one-branch vision, exactly as on a week (minimum one branch stays, the week rule).

Why the week's branches: they are the user's own areas, already named and coloured. Why not the defaults: a user who renamed `Me` to `Health` has told us something.

### 2.3 Validation

`validateAndRepairVision(raw)` wraps `validateAndRepair` (the week validator, which gives tombstones, parent/child consistency, branch minimum and the mixed-day repair) and then **strips** every field in the "never on a vision node" list, deletes any node whose `dayChild` / `tickChild` / `type === 'counter'` made it a leaf of the week's machinery, and normalises `horizon` to the three values or absent. It never invents `collapsed` or `horizon`.

Stripping, not refusing: a record that arrives via Drive from an older build, or a node moved in by hand through import, must land as a usable vision, not as a failed load.

---

## 3. Behaviour

### 3.1 The record in view

Today the renderer and every edit function read one global, `weekData`, and 28 call sites persist it with `saveWeek(currentWeekKey, weekData)`. The Vision does not introduce a second global for the map to read. Instead:

- `weekData` keeps its name and stays **the record the map is drawing**. While the Vision view is open it holds the vision record; otherwise the week.
- One new descriptor, `mapRecord`, says which: `{ kind: 'week' }` or `{ kind: 'vision' }`. `currentWeekKey` is untouched by the Vision and keeps naming the week the week bar is on.
- `saveMapRecord()` replaces every `saveWeek(currentWeekKey, weekData)` call. It dispatches on `mapRecord.kind`: `saveWeek(currentWeekKey, weekData)` or `saveVision(weekData)`. Call sites that save a week by explicit key (transfer, undo of another week, Drive merge) are not touched; they are already about a specific week.
- `openVisionIntoView()` is the Vision's `openWeekIntoView`: load, `rebuildNodeMap`, `syncBranchConfig`, `bridgeNotifyView`. No materialisation, no week lock, no next-week cache.

**Invariant R1:** `weekData` holds the vision record **if and only if** `currentView === 'vision'`. `switchView` is the only place that flips `mapRecord` and swaps `weekData`, and it swaps **before** it renders anything, so Agenda and Stats never read the vision by accident. Leaving the Vision reloads the week from IDB (`loadWeek(currentWeekKey)`), which is where a Drive merge or a peer tab may have written it meanwhile (section 3.4).

**Invariant R2:** every assignment to `weekData` outside `switchView` is guarded. The seven writers today:

| # | Writer | Guard |
|---|---|---|
| 1 | `openWeekIntoView` | Called only with `mapRecord.kind === 'week'`. From the Vision, week navigation is inert (section 3.6), and the `hashchange` handler switches to the Mindmap first. |
| 2 | Drive merge (`wKey === currentWeekKey` branch) | Becomes `wKey === currentWeekKey && mapRecord.kind === 'week'`. While the Vision is open the merged week goes to IDB only; the reload on leaving the Vision picks it up. The Vision has its own merge path (section 3.4). |
| 3 | `undo` / `redo` restore of the primary week | The Vision has its own stacks (section 3.3); the week stacks are never run while the Vision is in view. |
| 4 | `undo` reload of the view week | Same. |
| 5 | `_bridgeRollback` | Reads the active stack pair (section 3.3). |
| 6 | Import (`weekData = await loadWeek(viewWeek)`) | Import ends by reopening the week; it also calls `switchView('mindmap')` first if the Vision was open, so the import path never has to know about the Vision. |
| 7 | Boot (`let weekData = …`) | Unchanged. |

### 3.2 Writes

Every write the week map offers that has a meaning on the Vision works unchanged, because it edits `weekData` and ends in `saveMapRecord()`: add child (`Tab`, the "+" disc, `startAddNode` / `createTask`), rename (`commitEdit` / `applyLabelEdit`), comment, priority, drop (as Let go), undone (as take back), delete, drag, children reorder, branch add / delete / colour / side flip, recenter.

Writes that have **no** meaning are **inert while `mapRecord.kind === 'vision'`**, at the function, not only in the menu: `setStatus('done' | 'undone-from-done' | 'unplanned' | 'planned')`, `toggleReusableNode`, `setActivityDays`, `setTickDay`, `sendNodeToDate`, `moveNodeToWeek`, `transferUnfinished`, `transferReusable`, `clearWeek`, the baseline. Each returns without a snapshot and without a toast. The guard sits at the function so the keyboard, the Agenda-style swipe code and the bridge all meet the same wall.

**Label magic is off on the Vision.** `commitEdit` and `applyLabelEdit` skip `_applyMagicLabel` and the day-token parse when `mapRecord.kind === 'vision'`; a label is literal. "Run 3x a week" stays a sentence. Relative-day tokens are likewise not interpreted.

**Horizon** is set from the context menu (section 5), one submenu of three plus *No horizon*, the way priority is a submenu of three. Setting the current value is a no-op. Writing it calls `touchNode`; it is content.

### 3.3 Undo

Two stack pairs: the week's (`undoStack` / `redoStack`, as today, snapshots carrying `weekKey`) and the Vision's (`visionUndoStack` / `visionRedoStack`, snapshots carrying `weekData` only - no `nextWeekRaw`, no `scheduleRaw`, no colours beyond the Vision's own branch palettes). `takeSnapshot`, `undo`, `redo`, `_bridgeRollback` and `updateUndoRedoButtons` read **the pair that matches `mapRecord.kind`**. `MAX_UNDO` applies to each.

Why two: a week snapshot carries the next week's raw record and the schedule so that one undo can reverse a move or a send. None of that exists for the Vision, and a shared stack would let Ctrl+Z on the Vision rewind a week the user cannot see. `switchView` never clears either pair; the week's undo is waiting exactly where it was when the user comes back.

### 3.4 Storage and sync

| # | Concern | Rule |
|---|---|---|
| 1 | Local | IDB `misc` store, key `vision` (`VISION_STORAGE_KEY`), via `loadValueIDB` / `saveValueIDB`, as the schedule. `loadVision()` returns `validateAndRepairVision(raw)`; `saveVision(data)` writes, bumps `savedAt`, schedules the Drive push, and posts `week-saved` with `wk: 'vision'` on `tabChannel` so a peer tab showing the Vision re-merges (the multi-tab receiver treats `'vision'` like a week key: merge, then redraw only if that tab has the Vision in view). |
| 2 | Drive | One file, `zenit-week-vision.json` in `appDataFolder`. `_wKeyForDriveFileName` returns `'vision'` for it. Upload and download follow `syncScheduleToDrive` / `syncScheduleFromDrive` line for line: `visionSyncedHash` / `lastSeenRemoteVisionHash` self-echo guards, `appProperties` `savedAt` and `contentHash`, `forgetOn404`, failures logged and never shown as a week sync failure. |
| 3 | Merge | `mergeWeekData(local, remote, 'vision')`, unchanged. Tombstones win, `_ts` for content, `_posTs` for position and `collapsed`, remote wins ties. The result goes through `validateAndRepairVision` before it is saved or shown. If the Vision is in view and the merge changed the content signature, `weekData` is replaced, `rebuildNodeMap`, `refreshOpenComment`, `syncBranchConfig`, render - the week's merge tail, called with the vision record. |
| 4 | Changes feed | `pollDriveChanges` already maps file names to keys; `'vision'` joins `'colors'` and `'schedule'` as a non-week key and triggers `syncVisionFromDrive`. |
| 5 | Seeding vs. Drive | On a signed-in device with no local record, `openVisionIntoView` first awaits `syncVisionFromDrive` (bounded by the existing fetch timeout). Only when both are empty does the seed of section 2.2 run. A seed that raced a download would give the user two sets of areas and would merge both forever. |
| 6 | Export / import | `exportAllData` adds a `vision` key beside `schedule`; import validates it with `validateAndRepairVision` and writes it under `vision`. A bundle without the key leaves the local vision alone. |
| 7 | Sign-out, reset, dev reset | Each clears `vision` alongside `schedule`. `reloadAppFresh` is the way out, as today. |
| 8 | Colours | Branch palettes live in the shared colours blob keyed by branch id (V4). Nothing changes. |

### 3.5 Collapse and focus - the two investments for a large map

**Collapse.** `collapsed: true` on a vision node hides its subtree in `computeLayout` (the same pruning the view levels use, so a collapsed node is a leaf for layout), and the node wears a count badge in place of its "+" disc: the number of hidden descendants. Click the badge, or the context-menu item, to expand. The flag is layout (`touchLayout`), merges on `_posTs`, and is **not** snapshot-worthy: collapsing takes no undo entry, like a zoom. A collapsed node with no children loses the flag on validation. Day leaves and ticks never arise here, so the badge never has to explain them. The mechanism is generic to the renderer, but v1 **offers it only on the Vision** (menu gating, section 5); the week map gets it in a later change if it earns it.

**Focus.** *Focus branch* on a branch's context menu fits the viewport to that branch's bounding box (`fitMindmapView` with a subset of nodes) and dims every other branch to the Dropped opacity without the slash. Focus is view state, not data: `focusedBranchId`, cleared by Esc (an entry in `ESC_DISMISSALS` ahead of the view-level reset), by *Focus* on another branch, by clicking the center, by `F` and the logo (both fit the whole map), and by leaving the Vision. The view levels (`full` / `pebbles` / `rocks`) keep working inside a focus.

### 3.6 What the Vision switches off

While `currentView === 'vision'`:

| # | Surface | State |
|---|---|---|
| 1 | Week bar (arrows, picker, today) | Hidden. `[`, `]`, `Shift+arrows` and `T` are inert. The hash is left as it is; the week is still "open" underneath. |
| 2 | Day filter strip, `0`-`8` hotkeys, the filter chip | Hidden and inert. `dayFilterMatchSet()` returns null on the Vision regardless of `activeDayFilter`. |
| 3 | Quick add (`Q`, the "+" FAB) | Works, adding to the Vision: the panel's branch list shows the Vision's branches. Its day row is hidden. |
| 4 | Stats `S`, Agenda `A`, Later `L` | Switch view normally; `switchView` swaps the week back first (R1). |
| 5 | Center node | Label `t('vision.center')`, no completion ring (`updateCenterRing` is skipped), the avatar as today. Its context menu offers nothing in v1 beyond what the center offers on a week minus the week items (section 5). |
| 6 | Onboarding coachmarks, playground week | Not shown on the Vision yet. The empty-state hint was removed after review (2026-11-08); a Vision playground is to be specified. |
| 7 | Reload restore | `zenit-week-view` may hold `'vision'`. `readReloadRestore` restores it: boot opens the week as today, then `switchView('vision')`. |

---

## 4. Presentation

### 4.1 Mind map

The Vision draws with the week's renderer. Differences, all in existing hooks:

| # | Element | Vision |
|---|---|---|
| 1 | Center | Label from i18n, no ring. |
| 2 | Horizon | A right-hand badge icon per horizon (section 4.3a, row 5), never text on the label and never written into `label`. |
| 3 | Let go | The Dropped drawing unchanged: branch colour at 45%, diagonal slash, ⊘ badge. |
| 4 | Collapsed | Count badge in the "+" disc's place, branch colour, white numeral. |
| 5 | Focus | Non-focused branches at Dropped opacity, no slash, no badge. |
| 6 | Comment indicator | As today. Clicking it opens the editor, as today. |

### 4.2 Comments

No reading pane. An intention's comment is read and edited exactly as on a week: the comment indicator and the context-menu Comment item open the one comment editor (non-goal 6).

### 4.3 View toggle and hotkey

A fourth button, `#vtb-vision`, **first** in the bar (Vision, Mindmap, Agenda, Stats - decided 2026-11-08), same `.view-toggle-btn`, icon `#icon-telescope` (added to the sprite; one static SVG). On mobile the label hides like the others and four 36 px buttons fit the bar.

Hotkey: **`V`**, global, modifier-free, not while typing, placed with `A` / `M` / `S` in `_windowKeydownHandler`. `V` is today *cycle view level* on the Mindmap; that hotkey **moves to `W`** in the same change (handler, Help row `help.cycleViewLevel`, and any coachmark or tip text that names it), so Vision owns the letter it is named after. `W` is free on every map (the used letters are `a m l s q h t f v z y d u x c r n b p`). One change, both letters land together; there is no interim where either is unbound or doubly bound.

Help gets a `V` row in the views section and one short section *Vision* (what it is, Let go, horizon, collapse, focus). Czech throughout.

### 4.3a Horizon filter

The Vision's counterpart of the Mindmap's day filter (added 2026-11-08). The level row carries a `Horizon` cell (`#horizon-filter-btn`) in the slot the day cell leaves on the Vision, opening the same menu (`#day-filter-menu`, built by `openFilterMenu`): This year, In a few years, Someday, No horizon, then None. Hotkeys **`1`-`4`** in that order, on the Vision only, not while a node is hovered or while typing; the same key again clears.

| # | Rule | Behaviour |
|---|---|---|
| 1 | State | `activeHorizonFilter` (`null`, `year`, `years`, `someday`, `none`), separate from `activeDayFilter`, so neither clears the other. Not persisted, like the day filter. |
| 2 | Matching | `horizonFilterMatchSet`, returned by `dayFilterMatchSet` while the Vision is in view, so layout and Pebbles read one set. An intention matches on its effective horizon: its own, else its nearest ancestor's (`effectiveHorizon`). `none` is no effective horizon. A node stays when it or a descendant matches, so its branch stays. |
| 3 | New nodes | An intention added from the map while the filter shows a horizon takes it, unless it already inherits it (the day filter's stamp). Anything the filter cannot place (a branch, an agent add, a node under `none`) rides along in `_dayFilterFresh` until the filter changes. |
| 4 | Clearing | The Vision tab's reset, Esc and the home reset clear it with the day filter and the view level. The button face shows `∅` at rest and the horizon's icon when on, lit, like the day cell. |
| 5 | Icons | One icon per horizon, the same in the context menu, the filter menu, the filter button and the node badge: This year `calendar-exclamation`, In a few years `calendar-stats`, Someday `calendar-down`, No horizon `calendar-question`. On the map the horizon is a right-hand badge (`visionHorizonIcon`), never text on the label; a sub-intention that inherits its horizon wears none. |

### 4.4 Esc walk

Two entries join `ESC_DISMISSALS`, in this order relative to the existing ones: *focus* clears before the keyboard focus ring (it is the more transient state), and *leave Vision for Mindmap* sits beside the Stats and Agenda entries.

---

## 5. Context menu and naming

Gating runs on `mapRecord.kind`, before the node-type rules, the way `agendaEntryCtx` gates first today. Items on the Vision:

| # | Item | Shown on | Label (en / cs) |
|---|---|---|---|
| 1 | `ctx-add-child` | branch, activity | as today |
| 2 | `ctx-rename` | branch, activity | as today |
| 3 | `ctx-comment` | activity | as today |
| 4 | `ctx-prio-*` | activity | as today |
| 5 | `ctx-horizon-year` / `-years` / `-someday` / `-none` | activity, current value hidden | This year / Letos · In a few years / Za pár let · Someday / Jednou · No horizon / Bez horizontu |
| 6 | `ctx-dropped` | open activity | **Let go** / **Nechat být** (the same element, relabelled through `t()` when `mapRecord.kind === 'vision'`) |
| 7 | `ctx-undone` | let-go activity | **Take back** / **Vzít zpět** (same element, same relabel rule) |
| 8 | `ctx-collapse` / `ctx-expand` | activity or branch with children | Collapse / Sbalit · Expand / Rozbalit |
| 9 | `ctx-focus` | branch | Focus branch / Zaměřit větev |
| 10 | `ctx-change-color`, colour swatch | branch | as today |
| 11 | `ctx-delete` | branch, activity | as today, at once, no question |

Hidden on the Vision: `ctx-done`, `ctx-unplanned`, `ctx-reusable`, `ctx-reschedule`, `ctx-reset`, `ctx-transfer-unfinished`, `ctx-transfer-reusable`, `ctx-clear-week`, `ctx-set-baseline`, `ctx-clear-day-filter`, and their separators.

Keyboard on the Vision: `X` lets go (it is `setStatus('dropped')`), `U` takes back a let-go node (`ctx-undone`'s path), `D` and the day digits are inert (section 3.2), `C` comments, `R` renames, `Tab` adds, `Delete` deletes, `P` cycles priority, `F` fits, `W` cycles view level - all as on the Mindmap, with no new letters.

Toasts: *Let go* / *Taken back* replace *Dropped* / *Undone* when the record is the Vision; one i18n lookup keyed on `mapRecord.kind`.

### i18n keys

`view.vision`, `vision.center`, `menu.letGo`, `menu.takeBack`, `menu.horizon.year`, `menu.horizon.years`, `menu.horizon.someday`, `menu.horizon.none`, `menu.collapse`, `menu.expand`, `menu.focusBranch`, `horizon.year`, `horizon.years`, `horizon.someday`, `toast.letGo`, `toast.takenBack`, `help.visionView`, `help.vision.*` (section rows). Both languages, no key without both.

---

## 6. Agent surface

The bridge spec (`docs/specs/agent-bridge.md`, section 8) gains one resource and one tool; the existing node tools reach vision nodes by id. "The week in view" generalises to **the record in view** everywhere section 7 of that spec says it.

### 6.1 Resource

| # | URI | Content |
|---|---|---|
| 1 | `zenit://vision` | The vision record projected like section 8.3 of the bridge spec: `{ branches: [{ id, label, color, intentions: [{ id, label, priority, horizon, letGo, letGoAt, comments, children: [...] }] }] }`. From memory when the Vision is in view, else `loadVision()`. `collapsed`, positions and stamps omitted. Wire call `read_vision`, added to `READ_TOOLS`. |

`urisForWeekSaved` gets a sibling `urisForVisionSaved()` returning `['zenit://vision']`, and `saveVision` calls `bridgeNotifyVisionSaved` with the record's content signature so a no-op save stays silent, as weeks do.

### 6.2 Tools

| # | Tool | Behaviour |
|---|---|---|
| 1 | `open_vision` (new) | Navigation, like `open_week`: `switchView('vision')`, no undo entry. Required before any write to a vision node, exactly as `open_week` is required before writing a non-current week. Returns the projection. |
| 2 | `open_week` | Unchanged, and it also leaves the Vision: it ends on the Mindmap with the week in view. |
| 3 | `add_task` | On a vision branch id (the page resolves which record the branch belongs to): creates an intention. `days` or an `Nx` label with a vision branch is refused with `bad_args`, message naming the Vision. Requires the Vision in view, else `not_in_view` with the hint to call `open_vision`. |
| 4 | `rename_task`, `set_priority`, `set_comment`, `delete_task` | Work on a vision node id when the Vision is in view; `not_in_view` otherwise. Rename is literal (no label magic). |
| 5 | `set_status` | On a vision node accepts `dropped` (let go) and `undone` (take back) only; `done`, `unplanned`, `planned` return `wrong_type` with the message that the Vision has no done. |
| 6 | `set_horizon` (new) | `id`, `horizon` in `year, years, someday, none`. Same no-op rule as `set_priority`. |
| 7 | `set_days`, `tick_task`, `set_reusable`, `send_to_date`, `transfer_*` | `wrong_type` on a vision node or while the Vision is in view. |
| 8 | `undo` / `redo` | Act on the stack pair of the record in view (section 3.3). The result names the record. |
| 9 | `add_branch` | Adds to the record in view. |
| 10 | `rename_branch`, `delete_branch` (new) | `branch` (id or exact name) on the record in view, a week or the Vision. Rename is literal. Delete takes the branch's subtree with it, as the context menu does, and refuses the last branch with `wrong_type`. An id from the other record answers `not_in_view`. |

No `recommend` tool. The recommendation is the agent's reasoning over `zenit://vision` and `zenit://week/*`; the app offers the material and the write tools, nothing in between. `mcp/README.md` and the server's instruction string point the agent at `zenit://vision` as the thing to read before proposing a week.

---

## 7. Touch points

| # | Site | Change |
|---|---|---|
| 1 | Storage (`loadSchedule` / `saveSchedule` neighbourhood) | `VISION_STORAGE_KEY`, `loadVision`, `saveVision`, `validateAndRepairVision`, `emptyVision`. |
| 2 | Drive sync (`syncScheduleToDrive` / `-FromDrive`, `_wKeyForDriveFileName`, `pollDriveChanges`, `initDriveSync`) | Vision twins of the schedule paths; `'vision'` as a non-week key. |
| 3 | Drive week merge (line ~9571) | `mapRecord.kind === 'week'` guard. |
| 4 | `tabChannel` receiver | `wk: 'vision'` handled. |
| 5 | `switchView` | Fourth view; record swap first; week bar and filter strip visibility; `_mapDirty` logic extended to the Vision's canvas. |
| 6 | `_windowKeydownHandler` | `V` for Vision, cycle view level moved to `W`; inert groups per section 3.6; Esc entries. |
| 7 | `takeSnapshot`, `undo`, `redo`, `_bridgeRollback`, `updateUndoRedoButtons` | Active stack pair. |
| 8 | 28 × `saveWeek(currentWeekKey, weekData)` | `saveMapRecord()`. |
| 9 | `setStatus`, `toggleReusableNode`, `setActivityDays`, `setTickDay`, `sendNodeToDate`, `moveNodeToWeek`, `transferUnfinished`, `transferReusable`, `clearWeek`, baseline | Vision guard, no snapshot, no toast. |
| 10 | `commitEdit`, `applyLabelEdit` | Skip label magic and day tokens on the Vision. |
| 11 | `computeLayout` | `collapsed` pruning; focus bounding box. |
| 12 | `makeNodeGroup`, `updateNodeUI`, `nodeDisplayLabel` | Count badge, horizon annotation, focus dimming. |
| 13 | `showContextMenu` | Vision gating block; horizon, collapse, focus items; relabels. |
| 14 | `updateCenterRing`, `updateSummary` | Skip on the Vision. |
| 15 | Quick add panel | Branch list from the record in view; day row hidden on the Vision. |
| 16 | HTML | `#vtb-vision`, `#icon-telescope`, context-menu items. CSS in `<head>`, Flexbox, kebab-case. |
| 17 | `TRANSLATIONS` | Section 5 keys, en and cs. |
| 18 | Help | `V` row, `W` on the cycle-view-level row, and the Vision section. |
| 19 | `exportAllData` / import, sign-out, reset, dev reset | `vision` key. |
| 20 | `readReloadRestore` / `saveViewStateOnLeave` | `'vision'` as a view. |
| 21 | Bridge page side | `read_vision`, `open_vision`, `set_horizon`, `not_in_view`, record resolution by node / branch id, `bridgeNotifyVisionSaved`. |
| 22 | `mcp/core.js`, `mcp/server.js`, `mcp/README.md`, `docs/specs/agent-bridge.md` §8 | Resource, tools, `READ_TOOLS`, `urisForVisionSaved`, docs. |
| 23 | `npm run csp` | After every inline-script edit. |

---

## 8. Code style

- Everything in `zenit-week.html`; the MCP changes in `mcp/`. No new file.
- `'use strict'`, `const` / `let`, camelCase, `createElementNS` for SVG, `textContent` for every user string (labels, comments, branch names are user data and may arrive via Drive).
- The Vision never gets a second copy of a map function. Where behaviour differs, the existing function reads `mapRecord.kind`; where a function has no meaning on the Vision, it returns early. One way per action.
- `touchNode` for content (`label`, `comments`, `priority`, `horizon`, `dropped`), `touchLayout` for `collapsed`, `offX`, `offY`, `side`.
- No em dash anywhere.

---

## 9. Testing strategy

Vitest, under `tests/`, following the schedule and dropped-status files:

| # | File | Covers |
|---|---|---|
| 1 | `vision-record.test.js` | `validateAndRepairVision` strips week fields, deletes machinery leaves, normalises `horizon`, keeps `collapsed` only with children; `mergeWeekData` on two vision records (content on `_ts`, `collapsed` on `_posTs`, tombstones win). |
| 2 | `vision-seed.test.js` | Seed copies the week's branches (labels, sides, palettes, new UUIDs), copies no activity, and does not run when a local or remote record exists. |
| 3 | `vision-view-swap.test.js` | R1: `weekData` is the vision iff the view is `vision`; leaving reloads the week from IDB; Drive week merge while the Vision is open writes IDB only and is visible after leaving. |
| 4 | `vision-undo.test.js` | Two stack pairs; Ctrl+Z on the Vision never touches a week; the week's stack survives a round trip through the Vision. |
| 5 | `vision-writes.test.js` | Inert functions take no snapshot and show no toast on the Vision; label magic off (`"Run 3x"` stays literal, no ticks; `"(mo)"` stays text); Let go cascades and Take back reopens; horizon set / no-op. |
| 6 | `vision-layout.test.js` | `collapsed` prunes the subtree and counts descendants; focus bbox covers exactly the branch. |
| 7 | `vision-hotkeys.test.js` | `V` switches, `W` cycles the view level and the old `V` binding is gone; `[`, `]`, `T`, `0`-`8`, `D`, `U` on a non-let-go node are inert on the Vision; Esc order. |
| 8 | `vision-sync.test.js` | File name mapping, hash guards, changes-feed routing, export / import key, reset clears. |
| 9 | `agent-bridge.test.js`, `mcp-server.test.js` | `read_vision`, `open_vision`, `set_horizon`, `not_in_view`, `wrong_type` matrix, `urisForVisionSaved`. |
| 10 | `i18n.test.js`, `no-em-dash.test.js`, `csp-hashes.test.js` | Pass with the new keys and script. |

Manual: drag, zoom, pan, collapse badge, focus and Esc, comment editor round trip, reload restores the Vision, two tabs converge, two devices converge, `npm run validate`.

---

## 10. Boundaries

| # | Must not |
|---|---|
| 1 | Create a second renderer, layout, editor or merge for the Vision. |
| 2 | Let `weekData` hold the vision while any week view is on screen, or vice versa. |
| 3 | Mix the two undo stacks. |
| 4 | Let a Vision save write a week, or a week save write the Vision. |
| 5 | Put `done`, days, ticks, `reusable` or schedule fields on a vision node, through the UI or the bridge. |
| 6 | Seed the Vision before Drive has answered on a signed-in device. |
| 7 | Count the Vision in Stats, Transfer, Agenda, Overdue or Send to the Future. |
| 8 | Add a hotkey letter already in use. The one move this change makes (cycle view level to `W`) is specified in section 4.3; nothing else moves. |
| 9 | Show a browser-native dialog. |
| 10 | Use `innerHTML` with a label, comment or branch name. |

---

## 11. Acceptance criteria

| # | Criterion |
|---|---|
| 1 | `V` (and the fourth toggle button) opens the Vision from any view; `M`, `A`, `S`, `L` leave it; reload restores it. |
| 2 | First open on a fresh, signed-out device shows the week's branches, empty, with the hint; first open on a second signed-in device shows the first device's vision, not a seed. |
| 3 | Add, rename, comment, priority, drag, reorder, branch add / colour / side flip, delete all work on the Vision and survive reload, a second tab and a second device. |
| 4 | `X` on an intention lets it go (Dropped drawing, *Let go* toast); `U` takes it back; `D` does nothing. |
| 5 | A label `Pushups 10x` on the Vision is a literal label with no children. |
| 6 | Horizon shows as an annotation, is set from the menu and the bridge, merges across devices. |
| 7 | Collapse hides the subtree with a correct count, takes no undo entry, syncs as layout; Focus fits the branch, dims the rest, Esc clears it. |
| 8 | A comment on an intention opens and saves through the one comment editor, as on a week. |
| 9 | Ctrl+Z on the Vision undoes only Vision edits; switching to the week and pressing Ctrl+Z undoes the last week edit. |
| 10 | While the Vision is open, a week change from another device lands in IDB and is on the map when the user returns to the Mindmap; the Vision never shows week nodes. |
| 11 | The agent reads `zenit://vision`, calls `open_vision`, adds an intention with a comment, sets a horizon, and sees `wrong_type` for `set_days`; the week tools still work after `open_week`. |
| 12 | `W` cycles the view level on the Mindmap; `V` there opens the Vision. |
| 13 | `npm test`, `npm run validate`, `npm run csp` pass; no em dash. |

---

## 12. Decisions on the open questions (2026-11-08)

| # | Question | Decision |
|---|---|---|
| 1 | Let go: reuse the Dropped drawing and the ⊘ badge, or a glyph of its own? | Reuse. One visual language for "will not happen"; only the words differ. |
| 2 | Reading pane on the week map too? | Superseded: the pane was removed from the Vision as well (non-goal 6). |
| 3 | Deleting a Vision branch with intentions below | As a week: at once, undoable, minimum one branch remains. |
| 4 | Own onboarding coachmark set for the Vision? | Reopened (2026-11-08): the empty-state hint was removed; a Vision playground (sample intentions, tips) is to be specified. |

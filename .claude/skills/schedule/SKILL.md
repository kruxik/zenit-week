---
name: schedule
description: Send to the Future, the schedule record, occurrences and the Later tab in zenit-week.html. Load before touching any schedule, occurrence, materialise, sendNodeToDate, Later-tab, deleteNode-on-occurrence or schedule-merge code.
---

# Schedule (Send to the Future)

## The schedule record

A second record, in the IDB `misc` store under `schedule`, holding dated work that has nothing to do
with this week. It is never part of a week record: writing the schedule never writes a week, and
writing a week never touches the schedule.

```javascript
schedule = {
  entries: [
    { id, label, branch, priority,
      path,            // ['Health', 'Running'] — ancestor labels, outermost first, nearest 6 kept
      anchor,          // 'YYYY-MM-DD' — the first occurrence
      repeat,          // { every: N, unit: 'day'|'week'|'month'|'year' } | null
      end,             // { type: 'never' } | { type: 'count', n } | { type: 'until', date }
      plantedThrough,  // 'YYYY-MM-DD' — every occurrence up to here is accounted for
      planted,         // ['YYYY-MM-DD', …] — occurrences materialised ahead of plantedThrough
      _ts }            // epoch ms — Drive merge, same role as on nodes
  ],
  tombstones: [],      // deleted entry ids
  crdtVersion: 0,
}
```

An **entry** is a standing intention; an **occurrence** is what a week receives. Entries never render
on the map. A materialised occurrence is a plain `activity` node wearing its day the way any
single-day activity does — as a `(mo)` annotation in the label, never a `dayChild` leaf, which is the
rule `setActivityDays` has always applied — plus two extra fields, `schedId` and `schedDate` (the
real date, which for a swept occurrence is not the day the annotation names). Nothing else marks it — priority, comments, day tags, counters, dropped, transfer,
stats and drag all work on it untouched, because it is not a special kind of node.

An entry is always **one leaf task**, because that is the unit the user acts on: you go for a run,
then you stretch. Sending a parent therefore writes one entry per leaf below it — `Go for a run` and
`Stretching`, both with `path: ['Health', 'Running']` — and the parent leaves the week with them.
Nothing reconstructs a parent as an entity; the shared path is what puts the leaves back under one
node. Day children, tick leaves and legacy counters are the week's own machinery: a node wearing only
those is still a leaf, and none of them gets an entry (a tick count does not travel).

Path nodes are keyed on branch + label chain (`occurrencePathNodeId`), not on the entry, so two
entries under the same `Health/Running` converge on one scaffold node on every device; a step the
user has buried stops the walk and the occurrence lands one level higher. Scaffolding carries no
`schedId` and is never buried by deleting an occurrence, because it is shared. The entries a send
writes are otherwise **independent** — each has its own date, repeat and delete.

Caps: `SCHEDULE_SEND_MAX_LEAVES` 200, over which the send is **refused with a toast**, never
truncated; `SCHEDULE_PATH_MAX` 6 clips instead, because a dropped far ancestor loses no task, it only
re-homes the occurrence one level higher.


## Key functions
- `nextOccurrence(entry, from)` / `occurrencesInRange(entry, from, to)` / `occurrencesBefore(entry, to, limit)` — pure calendar arithmetic over `'YYYY-MM-DD'` strings. Month and year steps are measured from the anchor every time, so a clamped month never shifts it (31 Jan → 28 Feb → 31 Mar). `occurrencesBefore` lands on the last occurrence by arithmetic rather than enumerating the gap, which is what lets a device a decade behind sweep in one step
- `occurrenceNodeId(schedId, schedDate)` — the only node id in the app that does not come from `genId()`, and shaped exactly like one. Every idempotence property rests on it: an occurrence is planted only when this id is absent from **both** `nodes` and `tombstones` of that week record, which is what makes a reopen plant nothing, two devices converge on one node, and a deleted occurrence never return
- `captureSendLeaves(node)` / `isSendableLeaf(node)` — the leaves a send turns into entries, each with the ancestor labels it will be rebuilt under; `resolvePathParent` is the planting half that walks those labels back down
- `materialiseWeek(wk, data)` — plants due occurrences; on the current week it also runs `sweepPastDue`. Takes **no** undo snapshot — materialisation is delivery, not a user edit. Returns whether it planted; a sweep can advance the cursor without planting, so `_scheduleDirty` decides the schedule write separately
- `sendNodeToDate(nodeId, opts)` (returns the **list** of entries it wrote, one per leaf) / `updateScheduleEntry(id, opts)` / `deleteOccurrence(id, date)` / `deleteScheduleSeries(id)` — the four writes. Deleting a single occurrence writes the tombstone its week would have written anyway, so there is no skip-list field
- `mergeSchedule(local, remote)` — per-entry LWW on `_ts`, tombstones winning outright

## Behaviour
- **Send to the Future**: *Reschedule → Date* (last entry in the reschedule submenu, between the weekdays and *Any*; `activity` nodes only, which excludes ticks and day-leaves) moves a task out of this week into one schedule entry per leaf below it, each carrying its ancestor path. A **one-off date inside the week the node already lives in never becomes an entry**: it is the weekday selector with a calendar in front of it, so `sendNodeToDate` answers it with `setActivityDays` and returns an empty list — the node is retagged where it stands and a parent keeps its children. A repeat leaves even when its first occurrence falls this week; the week that owns the date materialises it back on open. One undo reverses both halves — snapshots carry `scheduleRaw`, and an operation reports the entries it created via `_noteScheduleAdditions`, read back per id exactly as `nextWeekAdded` is. It also reverses the occurrences the entry already planted: `_reverseOccurrences` asks the entry's calendar which stored weeks hold one (never `planted`, a cursor's bookkeeping that is pruned as the cursor moves), then buries those ids on undo and lifts exactly those tombstones on redo — nothing re-inserts an occurrence node, the entry replants it on the next week open. The scaffolding goes with them: `pruneOccurrencePath` takes down each path step whose id is the **derived** one (so this app built it, never a node the user already had — that keeps its `genId()`) and that is left with no children, deepest-first. It is removed but **never tombstoned** — a path id belongs to the path, not to the entry, so burying it would tell every later send down that path that the user had deleted the step. `resolvePathParent`'s tombstone guard is for a scaffold the user really did delete, which `deleteNode` buries under that same id. This is the one place scaffolding is removed; `deleteOccurrence` still leaves it, because deleting one occurrence of a series must not tear down a folder the others live in. Missed occurrences sweep onto the current week's Monday, one item per entry however long the absence
- **Later tab**: last in `AGENDA_TAB_ORDER`, reachable with `L`. A month-grouped reference list of upcoming occurrences from `laterFloorDate()` — the Monday after the week *today* falls in, so browsing to a future week never redefines what "upcoming" means. Materialising an occurrence does **not** remove it from the list: an entry that still owes a date keeps showing it, and a task visible both here and on the map is the same task seen from its two ends. The only thing that removes a row is its own week burying it (`deleteOccurrence`, or a pull into this week). That check reads the owning week's `tombstones`, which is an async load during a synchronous render, so `_laterBuried` caches it per week: an unknown week contributes its rows unfiltered, `primeLaterBuried` loads it, and Later re-renders once. `saveWeekIDB` invalidates the week both before and after the write, so a read racing a write cannot cache the pre-write answer. **No badge** — which is also why the agenda strip's staleness key needs nothing added for it. Rows use `buildAgendaItem` in entry mode: no Done, drag, swipe or context menu, because there is no node yet for those to act on. Their labels go through `getAgendaNodeLabel` / `getAgendaAncestorChain` exactly as a day row's do — the stand-in from `laterRowNode` carries `schedPath`, so the chain comes from the entry's `path` under its branch instead of being walked. A row opens its entry; deleting from it asks *this occurrence* or *the whole series*, and either answer reaches the map — see **Deleting a task**
- **Deleting an occurrence**: The **one** exception is an occurrence node whose entry is still live **and repeats** — there "this one" and "the series" are both ordinary readings of the gesture, so `deleteNode` hands off to `confirmDeleteOccurrence`, the same dialog a Later row opens from the other end of the task. `isSeriesEntry` decides, by asking the calendar for a second occurrence rather than reading `repeat` alone, so a repeat that ends after its first (`count: 1`, or an `until` before the second step) is the one-off it is; for a one-off nothing is asked, because both answers are the same act. *This occurrence* deletes the node where it stands **and** buries the date's own week (a swept or pulled occurrence sits in neither the week nor the date the other names). *Whole series* retires the entry and takes its occurrences with it from the current week forward — `_reverseOccurrences(entry, true, { notBefore })` — leaving past weeks as the history they are; one snapshot covers both halves, so undo restores the entry and lifts the tombstones

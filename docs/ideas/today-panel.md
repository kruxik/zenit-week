# Today Panel

## Problem Statement
How Might We give users a single place to see their whole day — pending tasks and what's been completed — without switching between two separate panels?

**Current state:** Two separate entry points (TODO toolbar button + Daily Log FAB) require two clicks to get full daily context. Both cover "today" but from different angles.

## Recommended Direction

One panel, one entry point. Remove the TODO toolbar button and the Daily Log FAB. Replace with a single "Today" entry point (toolbar button or FAB).

**Panel structure:**
```
┌─ Today ──────────────────────────────┐
│ ○ Morning run (Me)     [draggable]   │
│ ○ Team standup (Work)  [draggable]   │
│ ─────────────── Done ─────────────── │
│ ✓ Read chapter 3    09:42  ● Me      │
│ ✓ Send report      11:15  ● Work     │
│                                      │
│ [✓ 2]  [◑ 1]  [○ 5 total]           │
└──────────────────────────────────────┘
```

**Data source:** Both sections pull from the same pool — day-filtered `weekData.nodes` (same logic as current TODO). Pending = incomplete nodes. Done = nodes where `node.done === true` and `node.doneAt` starts with today's date, sorted by `doneAt` ascending. Counter nodes with `val > 0 && !done` stay in pending.

The old timestamped event log data structure is kept (it populates `doneAt`), but the Daily Log panel is removed. The merged panel replaces it.

## Key Assumptions to Validate
- [ ] All done tasks have a `doneAt` timestamp — tasks marked done before the timestamp commit won't have one; need a fallback sort (use `node.id` or fixed position at top of done section)
- [ ] "Done today" = `node.doneAt` starts with today's ISO date string, not just `node.done === true`
- [ ] Undoing a done task (toggling back) should move it live from done section back to pending — `openTodayPanel()` called on every state change like `openTodoPanel()` is today

## MVP Scope

**In:**
- Single `openTodayPanel()` function combining both data sources
- Pending section: current TODO logic (draggable, hover highlight, D key toggle)
- Done section: day-filtered done nodes with `doneAt` timestamp + branch dot
- Footer: done count + in-progress + total
- Single "Today" entry point (toolbar or FAB)

**Out:**
- `#daily-log-overlay`, `#daily-log-fab`, `#daily-log-panel` HTML + CSS (removed)
- `#todo-btn` from toolbar (removed)
- `openDailyLog()` function (removed or internalized)

## Not Doing (and Why)
- **Tabs (TODO | Activity)** — adds navigation cost, defeats the "one place" goal
- **Counter tick events in done section** — too granular, floods the view with "+1 Progress" noise; counter status is visible on the map
- **Keeping both entry points** — defeats the purpose of the merge
- **Unplanned badge in done section** — the day-filtered node pool doesn't track unplanned events; keep the done section simple

## Open Questions
- Entry point: toolbar button or FAB? FAB is better for mobile; toolbar button is more discoverable on desktop.
- Should the done section show tasks completed on previous days (marked done earlier in the week) or strictly today only?

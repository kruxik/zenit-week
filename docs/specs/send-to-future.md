# Spec: Send to the Future

Source idea: `docs/ideas/send-to-future.md`. That document holds the reasoning and the rejected
alternatives; this one holds what gets built.

## 1. Objective

Let a user hand a task to a specific future date — once, or on a repeating interval — and have it
arrive as an ordinary task in the week that owns that date.

Target user: someone already running their week in Zenit Week who also carries dated obligations that
have nothing to do with this week — taxes on 31 March, an annual electricity bill, a roadworthy check
every two years, a birthday every year. Today those have nowhere to live: a task can be held for this
week or pushed to next week (`N`, `moveNodeToNextWeek`, `zenit-week.html:10709`) and nothing further.

Success: the user stops keeping a parallel list of yearly obligations somewhere else, and no
obligation is discovered late because Zenit Week forgot it.

Two constraints decide the whole design and are restated here because every later decision follows
from them:

1. **No server, therefore no notifications.** A future item reaches the user only when they open
   Zenit Week in the relevant week. The weekly ritual *is* the delivery mechanism. Anything needing a
   phone alarm belongs in a real calendar.
2. **Future items are never pre-written into future week records.** Week records are both the unit of
   persistence (`loadWeek`, `zenit-week.html:10093`) and the unit of Drive sync
   (`scheduleDriveSync`, `zenit-week.html:8503`). Writing hundreds of dated items across a hundred-plus
   week keys, and re-writing them forever, is not affordable — and an unbounded repeat rule cannot be
   materialised at all.

## 2. Commands

No new build tooling. Existing workflow applies:

```sh
npm install        # once
npm test           # vitest — occurrence math, materialisation, sweep, schedule merge
npm run validate   # html-validate
npm run csp        # MANDATORY after any inline-script edit — a stale hash blocks the whole script
# manual: open zenit-week.html in a browser
```

## 3. Data model

### 3.1 The schedule record

A single new record, stored in the existing IndexedDB `misc` store (`openDB`,
`zenit-week.html:4993`) under the key `schedule`, and synced to Drive as its own file
`zenit-week-schedule.json` — the same non-week sync-key pattern the `colors` file already uses
(`_wKeyForDriveFileName`, `zenit-week.html:8850`).

```javascript
schedule = {
  entries: [
    { id, label, branch, priority,
      anchor,          // 'YYYY-MM-DD' — the first occurrence
      repeat,          // { every: N, unit: 'day'|'week'|'month'|'year' } | null
      end,             // { type: 'never' } | { type: 'count', n } | { type: 'until', date }
      plantedThrough,  // 'YYYY-MM-DD' — every occurrence up to here is accounted for
      planted,         // ['YYYY-MM-DD', …] — occurrences materialised ahead of plantedThrough
      _ts }            // epoch ms — Drive merge conflict resolution, same role as on nodes
  ],
  tombstones: [],      // deleted entry ids, same shape as week-record tombstones
  crdtVersion: 0,
}
```

An **entry** is a standing intention. An **occurrence** is what a week receives. Entries are never
rendered on the map; occurrences are ordinary nodes.

### 3.2 The occurrence node

A materialised occurrence is a plain `activity` node with a `dayChild` leaf on its weekday, plus two
extra fields:

| Field | Meaning |
|---|---|
| `schedId` | the entry it came from |
| `schedDate` | the occurrence date, `'YYYY-MM-DD'` |

Its node id is **deterministic**: derived from `schedId` + `schedDate`. This is load-bearing — see
F4. It is the only place in the app where a node id does not come from `genId()`, and the derivation
must produce an id in the same shape so nothing downstream can tell the difference.

Nothing else marks it. Priority, comments, day tags, counters, dropped, transfer, stats and drag all
work on it untouched, because it is not a special kind of node.

### 3.3 Cursor semantics — deviation from the idea doc

The idea doc said the entry cursor advances when an occurrence is *closed*. That is wrong: it lets
`transferUnfinished` carry an open occurrence into the next week while the entry still believes it
was never delivered, and it re-plants on the next week open.

**The cursor advances at materialisation, not at closure.** Closing an occurrence does nothing to its
entry. `plantedThrough` is a monotonic low-water mark advanced only by the current-week pass;
`planted` is a sparse list for occurrences materialised early because the user browsed ahead. Both
exist only to bound scanning and to stop the sweep re-delivering something already delivered —
in-week duplicate prevention is the deterministic node id (F4), which is authoritative and converges
across devices without the entry being consulted at all.

## 4. Project structure (where each piece lives in `zenit-week.html`)

| Piece | Placement |
|---|---|
| Schedule load/save/merge | beside the IDB helpers, `zenit-week.html:4993`–`5130` |
| Occurrence math (`nextOccurrence`, `occurrencesInRange`) | new pure-function block after the week utilities, `zenit-week.html:9061` |
| Materialisation + sweep | after `transferUnfinished`, `zenit-week.html:10452`, and called from the week-open path |
| Schedule Drive sync | with the `colors` file handling, `zenit-week.html:8780`–`8860` |
| *Send to date…* context menu entry + dialog | with the other `ctx-*` entries and the app-dialog markup |
| Later tab | with the agenda tab strip, `AGENDA_TAB_ORDER` `zenit-week.html:16733`, `renderAgendaStrip` `:16754`, `renderAgendaTabContent` `:17065` |
| `L` hotkey | with the other view keys in the global keydown handler |
| Strings | `TRANSLATIONS.en` / `TRANSLATIONS.cs` |

## 5. Core features & acceptance criteria

### F1 — Schedule store

- Loads from IDB `misc/schedule`; a missing record yields an empty schedule, never an error.
- Passes through a validate-and-repair pass mirroring `validateAndRepair` (`zenit-week.html:9843`):
  drop entries with no label or no valid anchor, coerce `repeat.every` to a positive integer, drop
  entries whose branch no longer exists **onto the first branch** rather than deleting them.
- Writing the schedule never writes a week record, and vice versa.

### F2 — Occurrence math (pure, unit-tested)

- `nextOccurrence(entry, fromDate)` returns the first occurrence on or after `fromDate`, or `null`
  when the end condition is exhausted.
- Interval units: `day`, `week`, `month`, `year`, any positive `N`.
- Month and year arithmetic **clamps into the month**: anchor 31 January + 1 month → 28 or 29
  February; the following step returns to 31 March (clamping never permanently shifts the anchor).
- End conditions: `never`; `count` (N occurrences total, including the anchor); `until` (inclusive).
- `repeat: null` yields exactly the anchor.
- All computation is on local calendar dates. No time-of-day exists anywhere in this feature.

### F3 — Send to date…

- New context-menu entry on `activity` nodes only, hidden for center, branch, counter, tick, day-leaf
  and inbox nodes, following the existing `ctx-*` hide rules.
- **Hidden for a node that has children.** One activity per entry; a node with a subtree cannot be
  sent. The Help panel states this; there is no partial or lossy variant.
- Opens a dialog (app-styled, following the `#app-confirm-overlay` pattern — never a browser dialog)
  with: date, repeat interval and unit, end condition. Defaults: date = today + 1 week, repeat =
  none, end = never.
- On confirm the node **moves**: it is removed from the current week and an entry is created carrying
  its label, branch and priority. It is not copied, and no stub is left behind.
- The move is one undo step: undo restores the node and removes the entry.
- `N` / move-to-next-week is untouched and remains the fast path for "not this week, next week".

### F4 — Materialisation on week open

- When a week is opened, every entry whose next occurrence falls inside that week's Mon–Sun bounds
  (`getWeekBounds`, `zenit-week.html:9065`) materialises as an occurrence node under its branch, with
  a `dayChild` leaf on the matching weekday.
- **Idempotence rule:** an occurrence is created only if its deterministic node id is absent from
  both `nodes` and `tombstones` of that week record. Consequences, all required:
  - Opening the same week twice creates nothing the second time.
  - Two devices opening the same week offline converge on one node, not two, when they sync.
  - A user who deletes an occurrence gets a tombstone, and the week never re-plants it.
- Materialisation runs inside the same week lock the transfer paths use, so a concurrent Drive pull or
  peer-tab merge cannot interleave with it.
- Materialisation is triggered by a user opening a week. There is no timer, no background job, and no
  service-worker involvement.
- Opening a **future** week materialises there and records the date in the entry's `planted` list
  without advancing `plantedThrough`.

### F5 — Past-due sweep

- On opening the **current** week, every occurrence dated after `plantedThrough` and before this
  week's Monday, and not listed in `planted`, materialises into the current week.
- A swept occurrence is placed on the **Monday** day-leaf of the current week, so it reads as overdue
  from Tuesday onward via the existing machinery (`getOverdueItems`, `zenit-week.html:12918`) and as
  simply due today on Monday itself. Its `schedDate` still records the real original date, which the
  Later tab and the agenda row display.
- After the pass, `plantedThrough` is set to the current week's Sunday and `planted` entries at or
  before it are pruned.
- The sweep is bounded by `plantedThrough`: a device restored from a year-old backup materialises each
  entry's outstanding occurrences once, not a year of history per entry.

### F6 — Later tab

- A tab after Sunday in the agenda day-tab strip, reachable with `←`/`→` like any other tab and
  directly with **`L`** from any view (`L` is free; `X` is now dropped, `9` collides with the numeric
  day strip).
- Lists upcoming occurrences grouped by month, each row showing date, label and branch colour, built
  with `buildAgendaItem()` (`zenit-week.html:16806`) so it matches every other agenda row.
- Rows edit the **entry**, not a node: tapping a row reopens the F3 dialog for date, repeat and end.
  Edits affect future occurrences only; already-materialised nodes are plain nodes and are edited in
  their own week.
- Renaming a materialised occurrence changes that node only and never rewrites the entry label.
- **No badge on the tab.** Later is a reference list, not a call to action.

### F7 — Delete semantics

- Deleting an occurrence node in its week is a normal node delete: it tombstones, and F4's idempotence
  rule means it never comes back. The series is unaffected.
- Deleting from the Later tab asks, via `showAppConfirm`, whether to delete **this occurrence** or
  **the whole series**. Deleting the series tombstones the entry; already-materialised nodes in past
  and current weeks stay exactly where they are.

### F8 — Drive sync

- The schedule syncs as `zenit-week-schedule.json` in the same appDataFolder, with the same
  `appProperties` `savedAt` / `contentHash` guards and the same self-echo suppression as week files.
- Merge is last-write-wins **per entry** on `_ts`, with tombstones winning over a stale live entry —
  the rule already used for nodes.
- A schedule sync failure never blocks or corrupts a week sync, and the reverse.

### F9 — i18n

- Every new string exists in `TRANSLATIONS.en` and `TRANSLATIONS.cs`: menu entry, dialog labels and
  units, tab label, empty state, delete-confirm copy, Help entries.
- Dates in the Later tab use the existing localised month names.

### F10 — Interaction with existing behaviour

- Occurrences count as **planned** in stats, never `unplanned`.
- An unfinished occurrence is carried by `Transfer Unfinished` like any other node; the copy is a
  plain node with the back-link stripped, so it can never be mistaken for a fresh materialisation.
- `Transfer Reusable` and `reusable` are untouched. `reusable` is conceptually a weekly rule and
  should converge with this engine eventually, but not in this change.
- Dropped, done, priority, comments and day tags all behave identically on an occurrence node.

## 6. Code style

- Everything in `zenit-week.html`; nothing moves to `sw.js` or any new file.
- `'use strict';`, `const`/`let`, camelCase, kebab-case ids and classes, styles in the `<style>` block.
- **Never** `innerHTML` with an entry label, a branch name or any schedule-derived string — schedule
  data arrives from Drive and is untrusted exactly like node data.
- No browser `confirm()`/`alert()`/`prompt()`; use `showAppConfirm` or the app-dialog pattern.
- Occurrence math is pure functions over date strings, with no reads of app state, so it is unit
  testable without a DOM.
- Reuse existing agenda-row and button classes; no new orphan classes.

## 7. Testing strategy

New `tests/schedule.test.js` (plus additions to existing suites where behaviour is shared):

| Area | Cases |
|---|---|
| Occurrence math | every unit and N; month-end clamping both directions; `count` and `until` exhaustion; `repeat: null`; leap day |
| Materialisation | plants in the right week and weekday; second open plants nothing; tombstoned occurrence never returns; two-device convergence on one node |
| Sweep | missed occurrence lands on Monday of the current week; `plantedThrough` advances and prunes; a year-old `plantedThrough` produces one occurrence per entry, not a year of them; browsing ahead then arriving does not double-plant |
| Send to date | node leaves the week, entry created with label/branch/priority; hidden for nodes with children; single undo step |
| Schedule record | repair drops invalid entries and re-homes orphan branches; merge is per-entry LWW; tombstone beats stale live entry |
| Existing suites | `transfer.test.js` — an unfinished occurrence transfers with the back-link stripped; `stats.test.js` — occurrences count as planned |

Manual verification in the browser: send a task to a date three weeks out, navigate there, confirm it
arrived on the right day; return to the current week and confirm nothing leaked back; miss a week and
confirm the sweep produces an overdue row; check both languages and both themes.

`npm run csp` after every inline-script edit, then `npm test` and `npm run validate`.

## 8. Boundaries

**Always**
- Keep the single-file policy.
- Treat schedule data as untrusted input.
- Make materialisation idempotent by node id before anything else.
- Run `npm run csp` after touching the inline script.

**Ask first**
- Any change to `reusable`, `transferUnfinished` or `transferReusable` semantics.
- Any new top-level view, or any change to the `M`/`A`/`S` set.
- Adding a field to the node model beyond `schedId` and `schedDate`.

**Never**
- Clock times, durations, event semantics, attendees, free/busy.
- Notifications, alarms, timers, or background materialisation of any kind.
- Pre-writing occurrences into future week records outside a user-initiated week open.
- A browser-native dialog.
- `innerHTML` with any schedule-derived string.

## 9. Out of scope (deferred)

- Weekday-of-month rules ("first Monday"), exception dates, full RRULE.
- `.ics` export or any calendar interop.
- Lead-time warnings ("surface three weeks early").
- Subtrees on entries.
- Migrating `reusable` into the rule engine.
- Search or filtering in the Later tab — revisit if the 200-entry manual check shows month grouping
  is not enough.

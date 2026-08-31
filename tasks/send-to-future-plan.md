# Plan — Send to the Future

Source spec: [`docs/specs/send-to-future.md`](../docs/specs/send-to-future.md)
Source idea: [`docs/ideas/send-to-future.md`](../docs/ideas/send-to-future.md)
Task list: `tasks/send-to-future-todo.md` · Branch: `feature/send-to-future` · Single file: `zenit-week.html`

## Principles

- **Vertical slices.** Each slice delivers one complete path a user or a test can exercise end to end.
- **Single-file policy.** Everything lands in `zenit-week.html`. `sw.js` is not touched.
- **Each slice ships with:** code + EN/CS i18n (where user-visible) + vitest coverage. `npm test`, `npm run validate` and `npm run csp` green before commit.
- **One commit per slice**, asked for before it happens.

## Dependency graph

```
┌──────────────────────────────┐
│ S1  Occurrence engine        │  pure date math, zero app state
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ S2  Schedule store           │  IDB misc record, repair, deterministic id
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ S3  Materialisation on open  │  ← the only change to existing week-open behaviour
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ S4  Send to date…            │  first complete user loop (send → navigate → arrive)
└──────────────┬───────────────┘
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐  ┌─────────────────┐
│ S5 Lifecycle│  │ S6 Later tab    │  independent of each other
│  sweep +    │  │  + L hotkey     │
│  transfer   │  │  + edit entry   │
└─────────────┘  └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │ S7 Delete       │  needs S6's rows and its i18n
                 │    semantics    │
                 └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │ S8 Drive sync   │  schedule as its own file
                 └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │ S9 Polish + gate│  Help, CHANGELOG, i18n parity, ship checks
                 └─────────────────┘
```

S5 and S6 are mutually independent once S4 is in and can land in either order. Everything before S4 is invisible on screen — deliberately.

## Why the order is S3 before S4

S4 (*Send to date…*) is the tempting first slice because it is the visible one. It must not be first: until S3 exists, sending a task removes it from the week and it arrives nowhere. That intermediate state is indistinguishable from data loss, and it is the state a mid-slice interruption would leave behind.

With S3 first, an entry seeded by a test (or by hand in the console) materialises correctly, and S4 then closes the loop the moment it lands.

## Where the risk actually is

**S3 is the regression cliff.** It is the only slice that changes what happens when an ordinary week opens, on every week, including for users who never create a single entry.

Four specific hazards, each with its mitigation:

1. **Three week-open paths, not one.** `loadAndRender` (`zenit-week.html:19136`), the `hashchange` handler (`:19175`) and the boot path all load a week independently. Materialisation must hook **one** shared function that all three call after `loadWeek` and before `rebuildNodeMap`, or weeks opened by URL hash will silently behave differently from weeks opened by the arrows.
2. **Re-entrancy.** `withWeekLock` (`:5062`) is explicitly **not** re-entrant. Materialisation runs under the lock for the week being opened; nothing it calls may take that lock again.
3. **`validateAndRepair` (`:9843`) is a garbage collector.** It must be taught to preserve `schedId` / `schedDate` the way it already preserves `dayChild` / `dayIndex`, or every occurrence node is stripped of its identity on the next load and re-plants as a duplicate.
4. **CRDT merge field lists.** `migrateCrdt` (`:9978`) and the week-merge path must carry the two new fields, or a Drive round-trip drops them — same failure as (3), but only on synced devices, which is worse because it is invisible locally.

The regression net is the existing suite unchanged: `week-record-invariants.test.js`, `persistence.test.js`, `crdt.test.js`, `sync-convergence.test.js`, `transfer.test.js`, `week-rollover.test.js`. If S3 needs any of those edited, that is the signal to stop and re-read the spec.

**Second risk, S3's core invariant:** the deterministic occurrence node id. It must be derived from `schedId` + `schedDate`, be shaped exactly like a `genId()` result so nothing downstream can distinguish it, and be checked against both `nodes` **and** `tombstones` before planting. Every idempotence property in the spec — reopening a week, two offline devices converging, a deleted occurrence staying deleted — rests on this single check.

**Third risk, S6:** the agenda strip is memoised on a small set of inputs (active tab, overdue count, week, language). A new tab that is not part of that key will render stale. Extend the key in the same edit that adds the tab.

## Slices

### S1 — Occurrence engine (pure)

`nextOccurrence(entry, fromDate)` and `occurrencesInRange(entry, from, to)` over `'YYYY-MM-DD'` strings. Interval units day/week/month/year with any positive N; month-end clamping in both directions; `never` / `count` / `until` end conditions; `repeat: null` yields the anchor alone.

No app state, no DOM, no storage. Verified entirely by vitest.

### S2 — Schedule store

The `schedule` record in the IDB `misc` store via the existing `loadValueIDB` / `saveValueIDB` helpers (`:5094`, `:5106`); an empty schedule for a missing record; a repair pass mirroring `validateAndRepair`; the deterministic occurrence-id helper.

Still invisible. After S2 a test can create entries and read them back across a reload.

### S3 — Materialisation on week open ← regression cliff

One shared hook on the week-open path plants due occurrences under their branch with a `dayChild` leaf. Idempotent by node id against `nodes` + `tombstones`. Runs under the week lock. Takes **no** undo snapshot — materialisation is not a user edit. Future weeks plant and record into `planted` without advancing `plantedThrough`.

### S4 — Send to date…

Context-menu entry on childless `activity` nodes only; app-styled dialog (date, interval, end); on confirm the node leaves the week and an entry is created carrying label, branch and priority; one undo step reverses both halves.

First slice with a complete user loop: send a task three weeks out, navigate there, it arrives.

### S5 — Lifecycle: sweep + transfer

Past-due occurrences sweep into the current week on the Monday leaf; `plantedThrough` advances to the current week's Sunday and prunes `planted`. `transferUnfinished` (`:10452`) strips `schedId`/`schedDate` from the copy it carries forward, so a transferred occurrence can never be mistaken for a fresh materialisation.

### S6 — Later tab

A tab after Sunday in `AGENDA_TAB_ORDER` (`:16733`), `L` from any view, rows built with `buildAgendaItem()` (`:16806`), grouped by month, showing the real `schedDate`. Tapping a row reopens S4's dialog against the **entry**. No badge.

### S7 — Delete semantics

Deleting an occurrence node in its week is an ordinary delete — the tombstone is what stops it returning, which S3 already guarantees. Deleting from the Later tab asks, via `showAppConfirm`, this occurrence or the whole series.

### S8 — Drive sync

`zenit-week-schedule.json` in the appDataFolder alongside `zenit-week-colors.json`, same `appProperties` `savedAt` / `contentHash` guards and self-echo suppression; `_wKeyForDriveFileName` (`:8850`) learns the `schedule` key; merge is per-entry LWW on `_ts` with tombstones winning.

### S9 — Polish and ship gate

Help panel entry for `L` and for *Send to date…* including the childless-node rule; CHANGELOG; EN/CS parity sweep; confirm occurrences count as planned in `stats.test.js`; full `npm test` + `npm run validate` + `npm run csp`.

## Checkpoints

- **⛔ CHECKPOINT 1 — after S2.** Foundation is in and nothing user-visible has changed. Confirm the schedule record survives a reload and that no existing test moved.
- **⛔ CHECKPOINT 2 — after S3.** The regression cliff. The six suites named above must pass **unmodified**. Nothing visible on screen unless an entry was seeded by hand.
- **⛔ CHECKPOINT 3 — after S4.** First user-visible loop. Verify by hand in the browser: send, navigate, arrive, undo.
- **⛔ CHECKPOINT 4 — after S8.** Two-device convergence before polish: same schedule on two profiles, offline edits both sides, one merged result.

## Out of scope

Everything in spec §9: weekday-of-month rules, `.ics` export, lead-time warnings, subtrees on entries, `reusable` migration, Later-tab search and filtering.

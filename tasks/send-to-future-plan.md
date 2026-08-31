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

## Risk register — resolved during implementation, not now

**None of these is resolved up front.** Each is carried until the slice that actually meets it. The rule for every one of them is the same:

> When the slice reaches the task tagged with a risk, **flag it in the report for that slice** — state what was found, whether the mitigation held, and what was done. If the mitigation does not hold, stop at the task rather than working around it.

Deciding these in advance would mean guessing at code that has not been read yet. Deciding them silently during the slice is how a wrong guess ships. Flagging is the middle path.

**S3 is the regression cliff.** It is the only slice that changes what happens when an ordinary week opens, on every week, including for users who never create a single entry. Five of the ten risks live there.

| # | Risk | Resolve at | Flag when |
|---|---|---|---|
| **R1** | **Three week-open paths, not one.** `loadAndRender` (`zenit-week.html:19136`), the `hashchange` handler (`:19175`) and boot each load a week independently. Materialisation must hook **one** shared function all three reach, or weeks opened by URL behave differently from weeks opened by the arrows. | S3 / T3.1 | The shared point turns out not to exist, or requires refactoring the three paths to create it. |
| **R2** | **`withWeekLock` (`:5062`) is not re-entrant.** Materialisation runs under the lock for the week being opened; nothing it calls may take that lock again. | S3 / T3.4 | Anything on the materialisation path already takes a week lock of its own. |
| **R3** | **`validateAndRepair` (`:9843`) is a garbage collector.** It must preserve `schedId` / `schedDate` as it preserves `dayChild` / `dayIndex` (`:9855`), or occurrences lose their identity on reload and re-plant as duplicates. | S3 / T3.7 | The repair pass has a field allow-list that is not obvious, or strips unknown fields by default. |
| **R4** | **CRDT merge field lists.** `migrateCrdt` (`:9978`) and the week-merge path must carry both new fields, or a Drive round-trip drops them — R3's failure, but only on synced devices, so invisible locally. | S3 / T3.8 | The merge enumerates fields explicitly anywhere. |
| **R5** | **Deterministic occurrence id.** Derived from `schedId` + `schedDate`, shaped exactly like a `genId()` result, checked against `nodes` **and** `tombstones` before planting. Every idempotence property in the spec rests on this one check. | S2 / T2.4, exercised S3 / T3.3 | The derivation cannot produce a `genId()`-shaped value without a hash dependency the single-file policy does not allow. |
| **R6** | **Undo after materialisation.** Materialisation takes no undo snapshot (T3.5). An undo that removes a freshly planted node leaves no tombstone, so the next week open re-plants it. Believed harmless; confirm rather than assume. | S3 / T3.5 | The re-plant is observable in a way that reads as a bug rather than as a refresh. |
| **R7** | **Sweep vs. future-browse double-plant.** The `planted` list and the deterministic id are supposed to cover this jointly. | S5 / T5.5 | Either mechanism alone turns out to be load-bearing — that means the other has a hole. |
| **R8** | **Agenda strip memoisation.** The strip is memoised on active tab, overdue count, week and language. A tab outside that key renders stale. | S6 / T6.2 | The Later tab's content depends on something the key cannot cheaply express. |
| **R9** | **`L` hotkey.** Believed unbound (`X` is dropped, `9` collides with the numeric day strip). Must also not fire during inline rename or in a text field. | S6 / T6.3 | `L` turns out to be taken, or the global handler cannot distinguish focus context at that point. |
| **R10** | **Drive failure independence.** A schedule sync failure must never block or corrupt a week sync, or the reverse. | S8 / T8.5 | The sync scheduler shares retry or backoff state across files. |

The regression net for R1–R6 is the existing suite unchanged: `week-record-invariants.test.js`, `persistence.test.js`, `crdt.test.js`, `sync-convergence.test.js`, `transfer.test.js`, `week-rollover.test.js`. **If S3 needs any of those edited, stop and re-read the spec** — that is not a risk to flag, it is a design error to fix.

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

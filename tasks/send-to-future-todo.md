# TODO — Send to the Future

Plan: `tasks/send-to-future-plan.md` · Spec: `docs/specs/send-to-future.md` · Branch: `feature/send-to-future`

Tasks tagged ⚠ **R#** carry a risk from the plan's risk register. They are **not** resolved in advance: when you reach one, report what you found and whether the mitigation held, and stop at the task if it did not.

Order: **S1 → S2 → S3 → S4**, then S5 and S6 in either order, then S7 → S8 → S9. Check off only when AC + verification both pass.

---

## S1 — Occurrence engine (pure)

- [x] T1.1 — New pure-function block after the week utilities (`:9061`): `nextOccurrence(entry, fromDate)` returning the first occurrence on or after `fromDate`, or `null` when the end condition is exhausted.
- [x] T1.2 — `occurrencesInRange(entry, fromDate, toDate)` returning every occurrence in an inclusive range, used by both materialisation and the sweep.
- [x] T1.3 — Units `day` / `week` / `month` / `year` with any positive integer `N`; `repeat: null` yields exactly the anchor.
- [x] T1.4 — Month and year arithmetic clamps **into** the month: 31 Jan + 1 month → 28/29 Feb, and the following step returns to 31 Mar. Clamping never permanently shifts the anchor.
- [x] T1.5 — End conditions: `never`; `count` (N total, anchor included); `until` (inclusive).
- [x] T1.6 — All dates are local-calendar `'YYYY-MM-DD'` strings. No `Date` time-of-day semantics leak in, and no UTC round-trip shifts a date across a day boundary.
- [x] T1.7 — `tests/schedule.test.js`: every unit, month-end clamping both directions, leap day, `count` and `until` exhaustion, `repeat: null`, a 2-year interval crossing a leap year.
- [x] T1.8 — `npm test` + `npm run validate` green.

**AC:** given an entry, the engine answers "what is the next occurrence" and "which occurrences fall in this week" correctly for every case in spec §5 F2.
**Verify:** `npm test`. No visual change anywhere.

---

## S2 — Schedule store

- [x] T2.1 — `loadSchedule()` / `saveSchedule()` on the IDB `misc` store key `schedule`, using the existing `loadValueIDB` (`:5094`) / `saveValueIDB` (`:5106`). A missing record returns an empty schedule, never throws.
- [x] T2.2 — Record shape per spec §3.1: `entries[]`, `tombstones[]`, `crdtVersion`.
- [x] T2.3 — `validateAndRepairSchedule()` mirroring `validateAndRepair` (`:9843`): drop entries with no label or invalid anchor; coerce `repeat.every` to a positive integer; re-home an entry whose branch no longer exists onto the first branch rather than deleting it.
- [x] T2.4 ⚠ R5 — `occurrenceNodeId(schedId, schedDate)`: deterministic, collision-free, and shaped exactly like a `genId()` result so nothing downstream can distinguish it. Same inputs always yield the same id, on every device.
- [x] T2.5 — A schedule write never writes a week record, and a week write never touches the schedule.
- [x] T2.6 — `tests/schedule.test.js`: round-trip through IDB; missing record; repair drops invalid entries and re-homes orphan branches; `occurrenceNodeId` determinism and shape.
- [x] T2.7 — `npm test` + `npm run validate` green.

**AC:** entries persist across a reload; a corrupt record repairs instead of throwing; occurrence ids are reproducible.
**Verify:** `npm test`. No visual change anywhere.

### ⛔ CHECKPOINT 1 — stop and report before starting S3

---

## S3 — Materialisation on week open ← regression cliff

- [x] T3.1 ⚠ R1 — Identify the **single** shared point every week-open path reaches after `loadWeek` and before `rebuildNodeMap` — `loadAndRender` (`:19136`), the `hashchange` handler (`:19175`) and boot all route through it. Hook materialisation there once; do not add three call sites.
- [x] T3.2 — `materialiseWeek(wk, weekData)`: for each entry, every occurrence inside that week's Mon–Sun bounds (`getWeekBounds`, `:9065`) becomes an `activity` node under its branch with a `dayChild` leaf on the matching weekday, carrying `schedId` and `schedDate`.
- [x] T3.3 ⚠ R5 — **Idempotence:** plant only if `occurrenceNodeId(...)` is absent from **both** `nodes` and `tombstones` of that week record. Reopening plants nothing; a deleted occurrence never returns.
- [x] T3.4 ⚠ R2 — Runs under the week lock for the week being opened. `withWeekLock` (`:5062`) is **not** re-entrant — nothing inside may take that lock again.
- [x] T3.5 ⚠ R6 — Materialisation takes **no** undo snapshot; it is not a user edit.
- [x] T3.6 — Opening a future week plants there and appends the date to the entry's `planted`, without advancing `plantedThrough`.
- [x] T3.7 ⚠ R3 — `validateAndRepair` (`:9843`) preserves `schedId` / `schedDate`, exactly as it preserves `dayChild` / `dayIndex` (`:9855`).
- [x] T3.8 ⚠ R4 — `migrateCrdt` (`:9978`) and the week-merge path carry both new fields through a Drive round-trip.
- [x] T3.9 — An `Nx` label materialises with its counter child auto-created, with no schedule-specific code.
- [x] T3.10 — `tests/schedule.test.js`: plants in the right week and on the right weekday; a second open plants nothing; a tombstoned occurrence never returns; two week records built independently from the same entry converge on one node after merge; a future-week open does not advance `plantedThrough`.
- [x] T3.11 — **These suites must pass unmodified:** `week-record-invariants.test.js`, `persistence.test.js`, `crdt.test.js`, `sync-convergence.test.js`, `transfer.test.js`, `week-rollover.test.js`. Editing any of them is the signal to stop and re-read the spec.
- [x] T3.12 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** a seeded entry arrives in its week on its weekday, exactly once, no matter how the week is opened or how many times; a week with no entries behaves byte-identically to today.
**Verify:** `npm test`, then manually seed an entry in the console and open its week twice.

### ⛔ CHECKPOINT 2 — stop and report before starting S4

---

## S4 — Send to date…

- [x] T4.1 — Context-menu entry, placed with the other `ctx-*` entries and following their hide rules: `activity` nodes only — hidden for center, branch, counter, tick, day-leaf and inbox nodes.
- [x] T4.2 — **Hidden for any node that has children.** One activity per entry; there is no partial or lossy variant.
- [x] T4.3 — App-styled dialog following the `#app-confirm-overlay` pattern — never a browser dialog. Fields: date, repeat interval + unit, end condition. Defaults: today + 1 week, no repeat, end never.
- [x] T4.4 — On confirm the node **moves**: removed from the current week, entry created carrying label, branch and priority. No copy, no stub left behind.
- [x] T4.5 — One undo step reverses both halves — node restored, entry removed.
- [x] T4.6 — `N` / `moveNodeToNextWeek` (`:10709`) is untouched.
- [x] T4.7 — EN + CS strings for the menu entry, every dialog label and unit, and the childless-node rule.
- [x] T4.8 — `tests/schedule.test.js`: node leaves the week and the entry carries label/branch/priority; the menu entry is hidden for a node with children; the whole move is a single undo step.
- [x] T4.9 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** sending a task three weeks out removes it from this week and it arrives there on the chosen day; undo puts it back.
**Verify:** `npm test`, then in the browser: send, navigate forward, confirm arrival, navigate back, confirm absence, undo.

### ⛔ CHECKPOINT 3 — stop and report before starting S5 / S6

---

## S5 — Lifecycle: sweep + transfer

- [x] T5.1 — On opening the **current** week, every occurrence dated after `plantedThrough`, before this week's Monday, and absent from `planted`, materialises into the current week.
- [x] T5.2 — A swept occurrence is placed on the **Monday** day-leaf of the current week; its `schedDate` still records the real original date.
- [x] T5.3 — After the pass, `plantedThrough` becomes the current week's Sunday and `planted` entries at or before it are pruned.
- [x] T5.4 — A device whose `plantedThrough` is a year old materialises each entry's outstanding occurrences **once**, not a year of them per entry.
- [x] T5.5 ⚠ R7 — Browsing ahead and later arriving at that week does not double-plant (the `planted` list plus the deterministic id both cover it).
- [x] T5.6 — `transferUnfinished` (`:10452`) strips `schedId` / `schedDate` from the copy it carries forward.
- [x] T5.7 — Swept occurrences read as overdue via the existing `getOverdueItems` (`:12918`) with no changes to it.
- [x] T5.8 — `tests/schedule.test.js` + an addition to `tests/transfer.test.js` covering T5.1–T5.6.
- [x] T5.9 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** a missed occurrence appears in the current week on Monday and reads as overdue; nothing is delivered twice; a long absence produces one item per entry.
**Verify:** `npm test`, then set a `plantedThrough` in the past by hand and open the current week.

---

## S6 — Later tab

- [x] T6.1 — New tab after Sunday in `AGENDA_TAB_ORDER` (`:16733`), rendered by `renderAgendaStrip` (`:16754`), reachable with `←` / `→` like any other tab.
- [x] T6.2 ⚠ R8 — **Extend the strip memoisation key** (active tab, overdue count, week, language) to include whatever the Later tab renders from, or it will show stale content.
- [x] T6.3 ⚠ R9 — `L` from any view opens the Agenda on the Later tab. Confirm `L` is unbound (`X` is dropped, `9` collides with the numeric day strip) and that it does not fire while a text field or an inline rename is focused.
- [x] T6.4 — Rows built with `buildAgendaItem()` (`:16806`), grouped by month, each showing date, label and branch colour. Localised month names.
- [x] T6.5 — Tapping a row reopens S4's dialog against the **entry**; edits affect future occurrences only.
- [x] T6.6 — Renaming a materialised occurrence node changes that node only and never rewrites the entry label.
- [x] T6.7 — **No badge on the tab.**
- [x] T6.8 — Empty state, tab label and every new string in EN + CS.
- [x] T6.9 — `tests/schedule.test.js`: tab order includes Later last; editing an entry does not touch already-materialised nodes; renaming an occurrence does not touch its entry.
- [x] T6.10 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** `L` opens a month-grouped list of what is coming; entries are editable there; no badge appears.
**Verify:** `npm test`, then in the browser check both languages and both themes.

---

## S7 — Delete semantics

- [x] T7.1 — Deleting an occurrence node in its week is an ordinary node delete; the tombstone is what stops it returning (already guaranteed by T3.3). No schedule-specific code on this path.
- [x] T7.2 — Deleting from the Later tab asks via `showAppConfirm`: **this occurrence** or **the whole series**.
- [x] T7.3 — Deleting the series tombstones the entry; already-materialised nodes in past and current weeks stay exactly where they are.
- [x] T7.4 — EN + CS strings for both confirm variants.
- [x] T7.5 — `tests/schedule.test.js`: series delete tombstones the entry and leaves existing nodes; occurrence delete leaves the series intact and never re-plants.
- [x] T7.6 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** both delete paths do exactly what their wording promises, and neither resurrects anything.
**Verify:** `npm test`, then delete one occurrence and one series in the browser.

---

## S8 — Drive sync

- [ ] T8.1 — The schedule syncs as `zenit-week-schedule.json` in the appDataFolder, beside `zenit-week-colors.json`.
- [ ] T8.2 — Same `appProperties` `savedAt` / `contentHash` guards and the same self-echo suppression as week files.
- [ ] T8.3 — `_wKeyForDriveFileName` (`:8850`) recognises the `schedule` key alongside `colors` and the week keys.
- [ ] T8.4 — Merge is per-entry LWW on `_ts`, with a tombstone beating a stale live entry.
- [ ] T8.5 ⚠ R10 — A schedule sync failure never blocks or corrupts a week sync, and the reverse.
- [ ] T8.6 — `tests/schedule.test.js` + additions to the sync suites: per-entry LWW, tombstone precedence, filename mapping, independent failure.
- [ ] T8.7 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** two devices editing different entries offline converge on both edits; a deleted entry stays deleted.
**Verify:** `npm test`, then the two-profile check below.

### ⛔ CHECKPOINT 4 — two-device convergence before polish

---

## S9 — Polish and ship gate

- [ ] T9.1 — Help & Hotkeys: `L` for Later, *Send to date…* including the childless-node rule.
- [ ] T9.2 — CHANGELOG entry.
- [ ] T9.3 — EN / CS parity sweep — `tests/i18n.test.js` must pass.
- [ ] T9.4 — Confirm in `tests/stats.test.js` that occurrences count as **planned**, never `unplanned`.
- [ ] T9.5 — Confirm no `innerHTML` anywhere near an entry label, branch name or any schedule-derived string.
- [ ] T9.6 — `CLAUDE.md`: schedule record, `schedId` / `schedDate`, the `L` hotkey and the Later tab in the hotkey list.
- [ ] T9.7 — Full `npm test` + `npm run validate` + `npm run csp` green; manual pass in both themes and both languages.

**AC:** the feature is documented where the app documents itself, and every gate is green.
**Verify:** the three commands, plus a browser pass.

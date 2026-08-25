# TODO — Dropped Status

Plan: `tasks/dropped-status-plan.md` · Spec: `docs/specs/dropped-status.md` · Branch: `feature/dropped-status`

Order: **S1 first, always.** S3 / S4 / S5 are independent of each other once S1 and S2 are in. Check off only when AC + verification both pass.

---

## S1 — Core state (logic only) ← regression cliff

- [x] T1.1 — `setStatus()` (`:11129`): add `'dropped'` branch — set `dropped` + `droppedAt`, clear `done`/`doneAt`/`donedOn`, `touchNode`, `setDescendants`, `syncStatusUp`. Set `fullRenderNeeded = true` (mirrors `unplanned`, since the badge changes node width).
- [x] T1.2 — `setStatus()`: add `'undropped'` branch — clear `dropped` + `droppedAt`, cascade, re-sync.
- [x] T1.3 — `setStatus()` `'done'` branch: clear `dropped`/`droppedAt` so D1 holds from both directions.
- [x] T1.4 — `setDescendants()` (`:11134`): handle both new statuses.
- [x] T1.5 — D3: the `'dropped'` branch must **not** touch `val` on a counter node (unlike `'done'`, which sets `val = max`).
- [x] T1.6 — `syncStatusUp()` (`:13306`) per spec §3.3: `parent.dropped` = every child dropped; `parent.done` = every child closed (`done || dropped`) **and** at least one child done. Manage `droppedAt` on the parent the way `doneAt` is managed.
- [x] T1.7 — `tests/dropped-status.test.js`: T1–T9 + T17 (set/clear, D1 both directions, D2 independence, D3 counter freeze, cascade down, all-dropped roll-up, mixed roll-up, one-open roll-up, no-dropped regression, undo).
- [x] T1.8 — `npm test` + `npm run validate` green. **`tests/status-propagation.test.js` must pass unmodified.**

**AC:** dropping a node sets the flag and cascades; a mixed done+dropped subtree rolls up to done; an all-dropped one rolls up to dropped and never done; a week with no dropped nodes rolls up byte-identically to today.
**Verify:** `npm test`. No visual change expected anywhere.

### ⛔ CHECKPOINT 1 — stop and report before starting S2

---

## S2 — Mind map + entry points

- [ ] T2.1 — Node fill/border selection (`:10985`): dropped branch keeps branch colour at ~45% opacity. Must sit **before** the `unplanned` case so a dropped+unplanned node reads as dropped.
- [ ] T2.2 — Diagonal slash: one SVG `line` corner-to-corner across the node rect, branch-coloured, `pointer-events: none`. Created with `createElementNS`.
- [ ] T2.3 — ⊘ badge: add the `<symbol>` to the sprite `<defs>` if absent; render in the existing badge row.
- [ ] T2.4 — Feed the badge width into the `rightW` / `textX` centering maths (`~11765`), exactly as the comment badge does.
- [ ] T2.5 — Confirm no `text-decoration: line-through` is applied to a dropped node (`:11839` is Done's mark only).
- [ ] T2.6 — Edge muting (`~12038`): treat dropped like done.
- [ ] T2.7 — Hotkey `X` on the hovered node, toggling drop/undrop. Register alongside `D`/`U`/`P`.
- [ ] T2.8 — `ctx-dropped` menu item (`:3898`) + show/hide wiring (hidden on center and branch nodes) + click handler.
- [ ] T2.9 — Show the existing `ctx-undone` for dropped nodes — it is the shared return-to-open path. **No new un-drop menu item.**
- [ ] T2.10 — i18n `menu.dropped` (Dropped / Vyřazeno) + `help.dropped`, both `en` and `cs`.
- [ ] T2.11 — Tests: hotkey dispatch, context-menu visibility per node type, i18n parity.
- [ ] T2.12 — `npm test` + `npm run validate` + **`npm run csp`** green.

**AC:** `X` drops and undrops; a dropped node is unmistakable from a done node at a glance in both themes; its label stays centred with any combination of badges.
**Verify:** browser, light + dark, all three view levels (Sand / Pebbles / Rocks). Screenshot a dropped node beside a done node.

### ⛔ CHECKPOINT 2 — visual language approval before S3–S6

---

## S3 — Lifecycle: transfers + overdue

- [ ] T3.1 — `transferUnfinished()` (`~10419`): candidate filter `!n.done` → `!n.done && !n.dropped`.
- [ ] T3.2 — `transferReusable()` (`~10590`): copy dropped nodes with `dropped`/`droppedAt` cleared.
- [ ] T3.3 — `moveNodeToNextWeek()` (`~10725`): move with the flag cleared, mirroring the `unplanned` handling at `:10755`.
- [ ] T3.4 — Add `syncStatusUp(n.id, 'dropped')` next to the existing `'done'` / `'unplanned'` re-syncs in all three paths.
- [ ] T3.5 — `getOverdueItems()` (`:12738`): guard `!n.done && !n.dropped`. Same for the unscheduled bucket below it.
- [ ] T3.6 — Tests T10–T13.
- [ ] T3.7 — `npm test` green; `tests/transfer*.test.js` unmodified.

**AC:** dropped tasks never arrive via Transfer Unfinished; Transfer Reusable and Next week both revive them; a dropped task never shows as overdue.
**Verify:** `npm test`, then manually drop a task, run Transfer Unfinished into next week, confirm absence.

---

## S4 — Stats

- [ ] T4.1 — `computeWeekStats()` (`~13608`): peel dropped out of `plannedOpen`/`unplannedOpen` into its own bucket. `total` unchanged; `done` unchanged.
- [ ] T4.2 — `STATS_SPLIT_BANDS` (`~13680`): add the grey/slate faded band. Donut, CFD and root ring all follow from this one list.
- [ ] T4.3 — `Dropped` headline row via `_statsHeadline` (`~13790`), rendered **last**, denominator `c.total`, guarded by `hasDropped`.
- [ ] T4.4 — `_computeSummarySignature()` (`:13588`): include `n.dropped`.
- [ ] T4.5 — i18n `stats.dropped`, both languages.
- [ ] T4.6 — Tests T14–T16.
- [ ] T4.7 — `npm test` green; `tests/stats.test.js` + `tests/summary.test.js` unmodified.

**AC:** dropping a task lowers completion %; the grey band appears in donut, CFD and root ring together; the headline row vanishes in a week with nothing dropped.
**Verify:** hand-compute a small week (e.g. 4 planned / 2 done / 1 dropped → 50% done, 25% dropped) and check the panel matches.

---

## S5 — Agenda

- [ ] T5.1 — Fourth group rendered **last**, after `Any day` (`~17272`).
- [ ] T5.2 — `makeSectionDivider` (`~17139`) with a sentence-case label — `.today-done-divider` uppercases via CSS (`:1551`).
- [ ] T5.3 — Hide the group entirely at count 0, as Done does.
- [ ] T5.4 — Rows at reduced opacity + ⊘ badge. No diagonal slash — it does not translate to a list row.
- [ ] T5.5 — Swipe-right undrops, mirroring Done's swipe-to-undone.
- [ ] T5.6 — Confirm dropped tasks never appear on the Overdue tab (falls out of T3.5 — assert it).
- [ ] T5.7 — i18n `agenda.dropped`, both languages.
- [ ] T5.8 — Tests: group ordering, empty-hiding, swipe-to-undrop.
- [ ] T5.9 — `npm test` green; `tests/agenda-order.test.js` unmodified.

**AC:** the Dropped group sits last, hides when empty, and swipe-right returns a task to open.
**Verify:** browser, a day with all four groups populated.

---

## S6 — Delete dialog

- [ ] T6.1 — `deleteNode` confirm path (`:11059`, `showAppConfirm` at `:18894`): pass `secondaryLabel` + `onSecondary` to drop instead of deleting.
- [ ] T6.2 — Body copy gains the explanatory line; set with `textContent` (node labels are user data).
- [ ] T6.3 — i18n `app-confirm.drop` (Drop / Vyřadit) + `confirm.deleteDropHint`, both languages.
- [ ] T6.4 — Verify no two buttons in the dialog share a word: `Zrušit` / `Vyřadit` / `Smazat`.
- [ ] T6.5 — Tests: secondary button present, drops rather than deletes, node survives.
- [ ] T6.6 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** the delete dialog offers Drop alongside Delete; choosing it leaves the node in the week, dropped.
**Verify:** browser at mobile width — three buttons must not wrap.

---

## S7 — Polish and ship gate

- [ ] T7.1 — Daily-log badge for dropped rows via the existing `.daily-log-badge` pattern (`:1590`).
- [ ] T7.2 — Help legend entry + `help.dropped` wiring (`~4286`).
- [ ] T7.3 — Update `CLAUDE.md`: data model, hotkey list (`X`), UI/UX guidelines.
- [ ] T7.4 — CHANGELOG entry.
- [ ] T7.5 — Full manual pass: both themes, all three view levels, mobile width, undo/redo, Drive sync round trip.
- [ ] T7.6 — `npm test` + `npm run validate` + `npm run csp` green.
- [ ] T7.7 — Walk spec §11 acceptance criteria, tick every box.

### ⛔ CHECKPOINT 4 — ship gate

---

## Notes

- Every slice: EN **and** CS strings in the same edit — `tests/i18n.test.js` enforces parity.
- **`npm run csp` after any inline-script edit.** A stale hash blocks the whole script and looks like total breakage, not a stale hash.
- Never `innerHTML` with a node label. Never a native `confirm()`/`alert()`/`prompt()`.
- Commit per slice, and ask before committing.

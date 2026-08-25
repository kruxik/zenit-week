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

- [x] T2.1 — Node fill/border selection (`:10985`): dropped branch keeps branch colour at ~45% opacity. Must sit **before** the `unplanned` case so a dropped+unplanned node reads as dropped.
- [x] T2.2 — Diagonal slash: one SVG `line` corner-to-corner across the node rect, branch-coloured, `pointer-events: none`. Created with `createElementNS`.
- [x] T2.3 — ⊘ badge: add the `<symbol>` to the sprite `<defs>` if absent; render in the existing badge row.
- [x] T2.4 — Feed the badge width into the `rightW` / `textX` centering maths (`~11765`), exactly as the comment badge does.
- [x] T2.5 — Confirm no `text-decoration: line-through` is applied to a dropped node (`:11839` is Done's mark only).
- [x] T2.6 — Edge muting (`~12038`): treat dropped like done.
- [x] T2.7 — Hotkey `X` on the hovered node, toggling drop/undrop. Register alongside `D`/`U`/`P`.
- [x] T2.8 — `ctx-dropped` menu item (`:3898`) + show/hide wiring (hidden on center and branch nodes) + click handler.
- [x] T2.9 — Show the existing `ctx-undone` for dropped nodes — it is the shared return-to-open path. **No new un-drop menu item.**
- [x] T2.10 — i18n `menu.dropped` (Dropped / Vyřazeno) + `help.dropped`, both `en` and `cs`.
- [x] T2.11 — Tests: hotkey dispatch, context-menu visibility per node type, i18n parity.
- [x] T2.12 — `npm test` + `npm run validate` + **`npm run csp`** green.

**AC:** `X` drops and undrops; a dropped node is unmistakable from a done node at a glance in both themes; its label stays centred with any combination of badges.
**Verify:** browser, light + dark, all three view levels (Sand / Pebbles / Rocks). Screenshot a dropped node beside a done node.

### ⛔ CHECKPOINT 2 — visual language approval before S3–S6

---

## S3 — Lifecycle: transfers + overdue

- [x] T3.1 — `transferUnfinished()` (`~10419`): candidate filter `!n.done` → `!n.done && !n.dropped`.
- [x] T3.2 — `transferReusable()` (`~10590`): copy dropped nodes with `dropped`/`droppedAt` cleared.
- [x] T3.3 — `moveNodeToNextWeek()` (`~10725`): move with the flag cleared, mirroring the `unplanned` handling at `:10755`.
- [x] T3.4 — Add `syncStatusUp(n.id, 'dropped')` next to the existing `'done'` / `'unplanned'` re-syncs in all three paths.
- [x] T3.5 — `getOverdueItems()` (`:12738`): guard `!n.done && !n.dropped`. Same for the unscheduled bucket below it.
- [x] T3.6 — Tests T10–T13.
- [x] T3.7 — `npm test` green; `tests/transfer*.test.js` unmodified.

**AC:** dropped tasks never arrive via Transfer Unfinished; Transfer Reusable and Next week both revive them; a dropped task never shows as overdue.
**Verify:** `npm test`, then manually drop a task, run Transfer Unfinished into next week, confirm absence.

### S3 deviation from the plan
- **T3.4 dropped.** S1 merged the `done` and `dropped` roll-ups into one branch of
  `syncStatusUp`, so the existing `syncStatusUp(n.id, 'done')` calls in all three
  paths already recompute `dropped`. A second call with `'dropped'` would run the
  identical code a second time. Not added — it would be dead code, not a safeguard.
- **One guard beyond the todo.** `getScheduledTickRows()` also needed `!n.dropped`,
  or a dropped tick would still render as a pending row on its weekday. Same class
  of guard as T3.5; nothing in S5 needs those rows.


---

## S4 — Stats

- [x] T4.1 — `computeWeekStats()` (`~13608`): peel dropped out of `plannedOpen`/`unplannedOpen` into its own bucket. `total` unchanged; `done` unchanged.
- [x] T4.2 — `STATS_SPLIT_BANDS` (`~13680`): add the grey/slate faded band. Donut, CFD and root ring all follow from this one list.
- [x] T4.3 — `Dropped` headline row via `_statsHeadline` (`~13790`), rendered **last**, denominator `c.total`, guarded by `hasDropped`.
- [x] T4.4 — `_computeSummarySignature()` (`:13588`): include `n.dropped`.
- [x] T4.5 — i18n `stats.dropped`, both languages.
- [x] T4.6 — Tests T14–T16.
- [x] T4.7 — `npm test` green; `tests/stats.test.js` + `tests/summary.test.js` unmodified.

**AC:** dropping a task lowers completion %; the grey band appears in donut, CFD and root ring together; the headline row vanishes in a week with nothing dropped.
**Verify:** hand-compute a small week (e.g. 4 planned / 2 done / 1 dropped → 50% done, 25% dropped) and check the panel matches.

### S4 additions beyond the todo
- **New theme token `--stats-dropped`** (slate; lighter in dark, matching how
  `--stats-plan`/`--stats-unplan` behave). §10 says ask before adding a token
  *rather than deriving from the branch colour* — but the spec mandates one grey
  band that is deliberately **not** branch-coloured, so there is nothing to derive
  from. Added alongside the two existing stats hues.
- **Three call sites T4.1 would have broken.** Peeling `dropped` out of the open
  buckets leaves a hole wherever the four buckets were summed against `total`:
  the per-branch bars (`_statsBranchRow`) grew a fifth neutral segment, and the
  CFD's morph shape (`ZERO` + `lerpShape`) grew the field. `_weekCompletion()`
  gained the same bucket so historical weeks split identically.
- **Legend entries.** An undecodable grey wedge is worse than no wedge: the donut/
  CFD legend and the branch-bar legend each gained a Dropped swatch, both guarded
  the way the unplanned ones are.
- **`tests/trend-completion.test.js` touched.** Four `toEqual` assertions compare
  the whole `_weekCompletion()` object, which now carries `dropped`. Added
  `dropped: 0` to each. It is not in the spec §9 regression net; `stats.test.js`
  and `summary.test.js` are, and both pass unmodified.


---

## S5 — Agenda

- [x] T5.1 — Fourth group rendered **last**, after `Any day` (`~17272`).
- [x] T5.2 — `makeSectionDivider` (`~17139`) with a sentence-case label — `.today-done-divider` uppercases via CSS (`:1551`).
- [x] T5.3 — Hide the group entirely at count 0, as Done does.
- [x] T5.4 — Rows at reduced opacity + ⊘ badge. No diagonal slash — it does not translate to a list row.
- [x] T5.5 — Swipe-right undrops, mirroring Done's swipe-to-undone.
- [x] T5.6 — Confirm dropped tasks never appear on the Overdue tab (falls out of T3.5 — assert it).
- [x] T5.7 — i18n `agenda.dropped`, both languages.
- [x] T5.8 — Tests: group ordering, empty-hiding, swipe-to-undrop.
- [x] T5.9 — `npm test` green; `tests/agenda-order.test.js` unmodified.

**AC:** the Dropped group sits last, hides when empty, and swipe-right returns a task to open.
**Verify:** browser, a day with all four groups populated.

### S5 interpretation — which tab a dropped task lands on
The todo says "fourth group, rendered last" but not what fills it. Two readings:
the tasks *scheduled for* that tab, or the tasks *dropped on* that tab's date.
Chose the second, keyed on `droppedAt` exactly as the Done log is keyed on
`doneAt`. It is the only reading that makes spec §4.5 true ("a record of *when*
you gave up, free"), it keeps an unscheduled dropped task visible somewhere —
S3's T3.5 removed those from Any day — and it stops one multi-day task repeating
across all seven tabs. Push back if the other reading was meant.

### S5 additions beyond the todo
- **`getDroppedItems(dateStr)` + `isAgendaRowNode(n)` hoisted to module level**,
  beside `getOverdueItems`/`getAnyDayItems`. `isAgendaRowNode` is the cross-day
  Done scan's eligibility rule, lifted verbatim so both groups apply one rule
  rather than two copies that can drift. Also what makes T5.8 testable —
  `renderAgendaTabContent` builds no real DOM under the test harness.
- **`pending` now excludes dropped**, or a dropped task would still sit in
  Scheduled as actionable.
- **The empty-day early return** counts dropped rows, or a day whose only content
  was dropped work rendered "nothing here" and skipped the group entirely.
- **CSS:** `.agenda-item-dropped` joins the existing `.agenda-item-done` opacity
  rules rather than duplicating them; `.daily-log-badge.dropped` follows the four
  existing badge variants and reuses S4's `--stats-dropped`.


---

## S6 — Delete dialog

- [x] T6.1 — `deleteNode` confirm path (`:11059`, `showAppConfirm` at `:18894`): pass `secondaryLabel` + `onSecondary` to drop instead of deleting.
- [x] T6.2 — Body copy gains the explanatory line; set with `textContent` (node labels are user data).
- [x] T6.3 — i18n `app-confirm.drop` (Drop / Vyřadit) + `confirm.deleteDropHint`, both languages.
- [x] T6.4 — Verify no two buttons in the dialog share a word: `Zrušit` / `Vyřadit` / `Smazat`.
- [x] T6.5 — Tests: secondary button present, drops rather than deletes, node survives.
- [x] T6.6 — `npm test` + `npm run validate` + `npm run csp` green.

**AC:** the delete dialog offers Drop alongside Delete; choosing it leaves the node in the week, dropped.
**Verify:** browser at mobile width — three buttons must not wrap.

### S6 discrepancy — there was no delete dialog
T6.1 and spec §4.4 both assume a delete confirm already exists ("Gains a secondary
button", "the confirm dialog gains an alternative"). It does not: `deleteNode()`
deleted immediately from the context menu, the mindmap's Backspace/Delete and the
agenda's. The only `showAppConfirm` near delete is Clear the Week.

Built the dialog rather than skipping the slice — without it Drop has no
discoverable entry point outside the `X` hotkey, which is most of the point of the
feature. Scoped so the new friction is as small as possible:
- **`deleteNode(id, { ask })`.** Only the three UI entry points pass `ask: true`.
  Every programmatic caller keeps the immediate delete — which is also what keeps
  `tests/status-propagation.test.js` passing unmodified, as spec §9 requires.
- **Standard activities only.** Tick-children and day-children are mechanical
  sub-rows of their parent; interrupting those deletes would be noise. Branches
  still route to `deleteBranch()` untouched.
- **Two new i18n keys beyond the spec's table** — `confirm.deleteTitle` and
  `confirm.deleteBody` — because the spec's copy block specifies a title and a
  first body line that had no keys to hang on.

**This adds a confirmation step to deleting a task, where there was none.** It is
one line to revert (drop the three `{ ask: true }` call sites) if the friction is
not wanted.


---

## S7 — Polish and ship gate

- [x] T7.1 — Daily-log badge for dropped rows via the existing `.daily-log-badge` pattern (`:1590`).
- [x] T7.2 — Help legend entry + `help.dropped` wiring (`~4286`).
- [x] T7.3 — Update `CLAUDE.md`: data model, hotkey list (`X`), UI/UX guidelines.
- [ ] T7.4 — CHANGELOG entry.
- [ ] T7.5 — Full manual pass: both themes, all three view levels, mobile width, undo/redo, Drive sync round trip.
- [x] T7.6 — `npm test` + `npm run validate` + `npm run csp` green.
- [x] T7.7 — Walk spec §11 acceptance criteria, tick every box.

### S7 notes
- **T7.1 already landed in S5.** The `.daily-log-badge.dropped` variant and the ⊘
  on Dropped rows shipped with the agenda group. Nothing left to add.
- **T7.4 — no handwritten CHANGELOG entry.** `npm run release` regenerates
  `CHANGELOG.md` with git-cliff from conventional commit messages and prepends the
  new version section. A hand-written entry would be overwritten at release and
  would conflict in the meantime. The five slice commits already carry the right
  `feat(...)` subjects, which are the entry.
- **T7.5 is the user's pass**, not something the suite can stand in for. Left
  unticked until it happens.
- **One extra i18n key:** `help.toggleDropped` (Toggle Dropped / Přepnout
  vyřazení), so the `X` row matches the `Toggle Done` / `Toggle Unplanned` form
  beside it. `help.dropped` from S2 labels the Legend swatch.
- **T7.7 walked.** Every §11 box holds against the code; the three
  `text-decoration: line-through` sites all gate on `done`, never `dropped`.

### ⛔ CHECKPOINT 4 — ship gate

---

## Notes

- Every slice: EN **and** CS strings in the same edit — `tests/i18n.test.js` enforces parity.
- **`npm run csp` after any inline-script edit.** A stale hash blocks the whole script and looks like total breakage, not a stale hash.
- Never `innerHTML` with a node label. Never a native `confirm()`/`alert()`/`prompt()`.
- Commit per slice, and ask before committing.

# SPEC — Dropped Status

> Source idea: `docs/ideas/dropped-status.md`
> Branch: `feature/dropped-status` (off `main`)
> Scope: net-new node state. Touches the data model, so Drive sync, transfer, stats and both languages are all in scope.

---

## 1. Objective

Give a task a way to be **closed without being done**. Today the only exit for "this will not happen" is Delete, which erases the task — so the week's record silently rewrites itself into "everything I kept was everything I planned", and the completion percentage flatters.

**Dropped** is a third value on the existing outcome axis (open / done / dropped). It keeps the task in the week, keeps it in the stats denominator, and unlocks the one number the current model cannot express: **drop rate**.

**Target user:** the existing single user — plans the week Mon morning / Sun evening, reflects at week's end. Mid-week, realises a task will not happen and wants to say so without lying to the stats or losing the record.

**Success:** dropping a task takes one keystroke, is visibly distinct from Done at a glance, never reappears in next week's transfer, and makes the week's completion percentage *more* honest rather than less.

### Non-goals

| Excluded | Why |
|---|---|
| Waiting / blocked flag | Different axis — *blocked but alive* belongs in the open bucket. Ship Dropped, learn, then decide. |
| Drop reasons / notes | The comment field already covers "why". A dedicated reason picker is a bet on data nobody reviews. |
| Bulk-drop at week end | Turns a considered decision into a chore-clearing swipe, destroying the honesty of the drop-rate number. |
| Changing what Delete does | Delete keeps its meaning: "this should never have been here." Only the confirm dialog gains an alternative. |

---

## 2. Data model

A `dropped: true` flag plus a `droppedAt` ISO timestamp, mirroring `done`/`doneAt` and `unplanned`/`unplannedAt`.

```
{ id, type, branch, label, parent, children,
  done, doneAt, donedOn,
  unplanned, unplannedAt,
  dropped, droppedAt,        ← new
  … }
```

**Invariants**

| # | Rule |
|---|---|
| D1 | `dropped` and `done` are mutually exclusive. Setting either clears the other **and its timestamps** (`doneAt`, `donedOn`, `droppedAt`). |
| D2 | `dropped` is independent of `unplanned`. Both may be true — an unplanned task that arrived and was then dropped is a real combination. |
| D3 | Dropping a counter node freezes `val` where it stands. The remaining `max - val` is recorded as never-happening, not still-open. |
| D4 | Absent `dropped` is falsy and means open. No migration is needed for existing weeks; `validateAndRepair()` must not invent the field. |

**Drive sync:** `dropped`/`droppedAt` live on the node object; `touchNode()` bumps `_ts`. Last-`_ts`-wins merging handles it with no extra code. No CRDT change.

---

## 3. Behaviour

### 3.1 setStatus

`setStatus(id, status)` (`zenit-week.html:11129`) gains `'dropped'` and `'undropped'`, alongside the existing `done`/`undone` and `unplanned`/`planned` pairs. Each does what the existing branches do: set flag + timestamp, `touchNode(id)`, `setDescendants(id, …)`, `syncStatusUp(id, …)`.

`takeSnapshot()` is already called on entry, so undo/redo needs no work.

### 3.2 Cascade down

`setDescendants` (`zenit-week.html:11134`) gains the two statuses. Dropping a parent drops the whole subtree, exactly as `done` does.

### 3.3 Cascade up — the one place existing behaviour changes

`syncStatusUp(nodeId, prop)` (`zenit-week.html:13306`) currently computes `allTrue = siblings.every(s => s[prop])`. That generic form is not sufficient here, because a subtree of "some done, some dropped, nothing open" must roll up to **done**, and `s.done` is false on a dropped child.

Replace the single predicate with two explicit rules:

| Parent flag | Becomes true when |
|---|---|
| `parent.dropped` | **every** child is dropped |
| `parent.done` | **every** child is closed (`done \|\| dropped`) **and at least one** child is done |

This satisfies D1 by construction: an all-dropped subtree has no done child, so the parent is dropped and not done; a mixed subtree has at least one done child and at least one non-dropped child, so the parent is done and not dropped.

`prop === 'unplanned'` keeps its current `every(s => s.unplanned)` behaviour, untouched.

**Regression risk:** this changes the roll-up for `done` even in weeks with no dropped tasks. With `dropped` absent everywhere, `done || dropped` reduces to `done`, and "at least one done" is implied by "every child done" for any non-empty sibling list — so behaviour is identical. `tests/status-propagation.test.js` must still pass unchanged.

### 3.4 Transfer and movement

| Path | Behaviour on a dropped node | Why |
|---|---|---|
| `transferUnfinished()` (`~10419`) | **Skips it.** Candidate filter `!n.done` becomes `!n.done && !n.dropped`. | This is precisely what Dropped means. |
| `transferReusable()` (`~10590`) | **Copies it, clearing `dropped`/`droppedAt`.** | A weekly recurring task must not be killed forever by one bad week. Mirrors the existing clearing of `unplanned`/`unplannedAt`. |
| `moveNodeToNextWeek()` (`~10725`) | **Moves it, clearing `dropped`/`droppedAt`.** | An explicit move is a decision to re-plan. Same reasoning the code already applies to `unplanned` at `:10755`. |

After each, re-sync parents for the new property alongside the existing `syncStatusUp(n.id, 'done')` / `'unplanned'` calls.

### 3.5 Overdue

`getOverdueItems()` (`zenit-week.html:12738`) filters on `n.type !== 'activity' || n.done`. Without a fix a dropped task nags as overdue forever. Guard becomes `!n.done && !n.dropped`. The unscheduled-items bucket immediately below needs the same treatment.

---

## 4. Presentation

### 4.1 Mind map

Every obvious treatment is already spoken for — grey + horizontal strike is Done, amber + bolt is Unplanned, dashed is the keyboard focus ring (explicitly reserved: "nothing else on the map is dashed", `:3276`), hatching is Unplanned in the Stats legend.

**Dropped node = branch colour at ~45% opacity + a diagonal slash + a ⊘ badge.**

| Element | Detail |
|---|---|
| Fill / border | Branch colour retained, ~45% opacity. **Not grey** — it must never read as Done at a glance, and the branch that bled stays visible. |
| Slash | One SVG `line`, corner-to-corner across the node rect, branch-coloured. Done strikes the *text* horizontally; Dropped strikes the *node* diagonally. |
| Badge | ⊘ in the existing badge row (bolt / repeat / comment slot). Survives greyscale, colour-blindness, and the zoomed-out Rocks view where a thin diagonal gets small. Its width must be factored into the badge-row `rightW` / `textX` centering maths, exactly as the comment badge is. |
| Edges | Incoming edges mute as they do for done nodes (`~12038`). Both are closed states; a second muted-edge style buys nothing. |
| Text | **No** `text-decoration: line-through` — that is Done's mark (`:11839`). |

`getThemeColors()` (`:6276`) gains `DROPPED_*` entries if the slash needs a theme-aware colour; prefer deriving from the branch colour so no new token is required.

Dropped nodes **stay on the map**. Hiding them would make Drop functionally identical to Delete, which is the thing this feature exists to prevent. The view-level cycle (Sand / Pebbles / Rocks) is already the tool for clutter.

### 4.2 Agenda

A day tab renders three groups today, in this order (`~17272`):

```
Scheduled   renderGroup(pendingRows, 'pending', t('agenda.scheduled'))
Done        renderDoneSection(done) — chronological, swipe-right → undone
Any day     renderGroup(anyRows, 'anyday', t('agenda.anyDay'))
```

Dropped gets a **fourth group, rendered last** — after `Any day`, not under `Done`. Everything above it is actionable; the dropped group is the only one that is not.

- Built with the same `makeSectionDivider(labelText, count)` the Done section uses (`~17139`).
- Hidden entirely when the count is 0, like Done.
- Rows at reduced opacity with the ⊘ badge. The diagonal slash is a mind-map mark and does not translate to a list row.
- **Swipe-right undrops**, mirroring Done's swipe-to-undone, so a mistaken drop is recoverable from the surface that shows it.
- The divider label is stored **sentence case** — `.today-done-divider` applies `text-transform: uppercase` (`:1551`).
- On the **Overdue tab** the layout differs (pending grouped by weekday name). Dropped tasks must not appear there at all; §3.5 handles it.

### 4.3 Stats

Dropped stays in the completion-% **denominator**. A week where you plan 20 and drop 8 does not report 100%. But it must not merge into "open" — "still could happen" and "will not happen" are different facts.

`computeWeekStats()` (`~13608`) splits leaves into `plannedDone` / `plannedOpen` / `unplannedDone` / `unplannedOpen`. Dropped work is peeled out of the two `*Open` buckets into its own:

| Band | Colour | Meaning |
|---|---|---|
| planned done | green, solid | delivered as planned |
| unplanned done | amber, solid | delivered, unplanned |
| planned open | green, faded | still live |
| unplanned open | amber, faded | arrived, still live |
| **dropped** | **grey/slate, faded** | closed, will not happen |

Grey deliberately — red is priority-critical, amber is unplanned. One band, not split by provenance; the provenance of a dropped task is rarely the interesting part.

`STATS_SPLIT_BANDS` (`~13680`) is the single list painting the donut, the CFD bands and the root completion ring, so one entry there keeps all three in agreement by construction.

**Drop rate is a fourth headline row, rendered last**, via the existing `_statsHeadline(labelKey, pct, rawA, rawB)` (`~13790`):

```
Plan completion        63%   (12 / 19)
Unplanned load         18%   (4 / 23)
Unplanned completion   75%   (3 / 4)
Dropped                17%   (4 / 23)   ← new
```

Denominator is `c.total`, matching "Unplanned load" so the two read on one scale. Guarded by `hasDropped` exactly as the unplanned rows are guarded by `hasUnplanned` — in a week with nothing dropped, the row does not exist.

**Signature:** `_computeSummarySignature()` (`:13588` — note: the idea doc calls this `weekSignature()`, which does not exist) must include `n.dropped`, or the Stats panel will not refresh when a task is dropped.

### 4.4 Entry points

| Surface | Detail |
|---|---|
| Context menu | New `ctx-dropped` item next to `ctx-done` / `ctx-undone` (`:3898`). Hidden for center and branch nodes. |
| Un-drop | **No new menu item.** The existing `ctx-undone` ("Undone" / "Nesplněno") is the return path from either closed state — it already means "back to open", and the outcome axis has one open state with two ways into it. Show it for dropped nodes too. |
| Hotkey | `X` on the hovered node, toggling drop/undrop. Verified unused. |
| Delete dialog | Gains a secondary button. `showAppConfirm` already supports it via `secondaryLabel` / `onSecondary` (`:18894`) — no new dialog machinery. Delete stays the primary danger action. |

Delete dialog copy — the button is a bare verb, not "Drop instead"; three buttons side by side already read as three alternatives, and the Czech "místo toho" leaves the reader hunting for the referent. The body carries the explanation:

```
Smazat úkol?
Tato akce ho odstraní natrvalo.
Vyřazený úkol zůstane v týdnu a započítá se do statistik.

[ Zrušit ]   [ Vyřadit ]   [ Smazat ]
[ Cancel ]   [ Drop ]      [ Delete ]
```

### 4.5 Daily log

`droppedAt` mirrors `doneAt`/`unplannedAt`, so dropped tasks appear in the day's rows with their own badge via the existing `.daily-log-badge` pattern (`:1590`) — a record of *when* you gave up, free.

---

## 5. Naming and label form

**English: Dropped / Drop. Czech: Vyřazeno / Vyřadit.**

*Vyřadit* means "take out of the lineup" — the thing existed, it is simply out. `vyřa*` appears **zero** times in the file today, which the alternatives could not claim:

| Rejected | Why |
|---|---|
| Zrušeno / Zrušit | **Collides.** "Zrušit" is every dismiss button in the app, including the delete dialog's own (`app-confirm.cancel`, `:9673`). |
| Zahozeno / Zahodit | Reads as "throw away" — closer to Delete than Drop, harsher than the English. |
| Odloženo / Odložit | Means *postponed*. Implies it comes back — the opposite of the feature. |
| Canceled (EN) | Would disagree with the Stats row, which reads "Dropped". |
| Won't do (EN) | Reads as a sentence next to one-word items like Done and Unplanned. |

### Label form

The context menu is not mixed-form; it follows a rule, and Dropped must follow it:

| Class | Form | Examples |
|---|---|---|
| **A — state toggle** | target *state*, adjective/participle | Done / Undone · Hotovo / Nesplněno<br>Unplanned / Planned · Neplánované / Plánované<br>Reusable / Disposable · Opakované / Jednorázové |
| **B — one-shot action** | imperative (Czech: infinitive) | Delete · Smazat<br>Rename · Přejmenovat<br>Clear the Week · Vymazat týden |

Dropping is a state toggle, so it takes **both** forms — each in its own class:

| Surface | Class | EN | CS |
|---|---|---|---|
| Context menu item | A | Dropped | Vyřazeno |
| Agenda section divider | A | Dropped | Vyřazeno |
| Stats headline row | A | Dropped | Vyřazeno |
| Delete dialog button | B | Drop | Vyřadit |
| Return to open | A (existing) | Undone | Nesplněno |

### i18n keys

| Key | EN | CS |
|---|---|---|
| `menu.dropped` | Dropped | Vyřazeno |
| `agenda.dropped` | Dropped | Vyřazeno |
| `stats.dropped` | Dropped | Vyřazeno |
| `confirm.deleteDropHint` | A dropped task stays in the week and counts toward your stats. | Vyřazený úkol zůstane v týdnu a započítá se do statistik. |
| `app-confirm.drop` | Drop | Vyřadit |
| `help.dropped` | Dropped | Vyřazeno |

Both `TRANSLATIONS.en` and `TRANSLATIONS.cs` must gain every key — `tests/i18n.test.js` enforces parity.

---

## 6. Commands

```sh
npm install       # once
npm test          # vitest — required, this is a data-logic change
npm run validate  # html-validate
npm run csp       # MANDATORY after any inline-script edit
```

`npm run csp` regenerates the inline-script CSP hashes. Skipping it leaves a stale hash that blocks the entire script — the app appears completely broken, which reads as "the change broke everything" rather than "the hash is stale".

---

## 7. Touch points

Single-file policy holds: everything lands in `zenit-week.html`. `sw.js` is not touched.

| Area | Anchor |
|---|---|
| Theme colours | `getThemeColors()` `:6276` |
| Node fill / border selection | `:10985` |
| Node text decoration | `:11839` |
| Badge row + centering maths | `~11765` |
| Edge muting | `~12038` |
| `deleteNode` | `:11059` |
| `setStatus` / `setDescendants` | `:11129` / `:11134` |
| `syncStatusUp` | `:13306` |
| `getOverdueItems` | `:12738` |
| Transfers | `~10419`, `~10590`, `~10725` |
| Stats computation / bands / headline | `~13608`, `~13680`, `~13790` |
| Summary signature | `:13588` |
| Agenda groups / divider / done section | `~17272`, `~17139`, `~17155` |
| Context menu markup | `:3898` |
| `showAppConfirm` | `:18894` |
| Translations | `~9140` (en), `~9461` (cs) |

---

## 8. Code style

Per `CLAUDE.md`, non-negotiable:

- `'use strict'`; `const`/`let`, never `var`; camelCase.
- SVG via `document.createElementNS('http://www.w3.org/2000/svg', tag)`.
- **Never** `innerHTML`/`outerHTML`/`insertAdjacentHTML` with user-controlled strings. Node labels reach the delete dialog and the agenda rows — use `textContent`. The only permitted `innerHTML` is a fully static constant such as `iconSvg()`.
- No browser-native `confirm()`/`alert()`/`prompt()` — the delete flow uses `showAppConfirm`, which is already the case.
- Reuse `.agenda-action-btn`; do not invent a button class. The `.danger` variant exists in confirm dialogs only.
- Surgical `updateNodeUI()` over full `render()` where the change is visual-only. Dropping changes layout only via the badge width, so a full render is needed when the badge appears or disappears — mirror how `unplanned` sets `fullRenderNeeded = true`.

---

## 9. Testing strategy

Existing suites that must stay green **unchanged** — they are the regression net for §3.3:

`status-propagation.test.js`, `transfer.test.js`, `transfer-logic.test.js`, `stats.test.js`, `summary.test.js`, `agenda-order.test.js`, `i18n.test.js`, `csp-hashes.test.js`, `data.test.js`, `history.test.js`.

New: **`tests/dropped-status.test.js`**

| # | Case |
|---|---|
| T1 | `setStatus(id,'dropped')` sets `dropped` + `droppedAt`; `'undropped'` clears both. |
| T2 | D1 — dropping a done node clears `done`, `doneAt`, `donedOn`; marking a dropped node done clears `dropped`, `droppedAt`. |
| T3 | D2 — `unplanned` survives a drop/undrop round trip. |
| T4 | D3 — dropping a counter leaves `val` untouched (does **not** set `val = max`, unlike done). |
| T5 | Cascade down — dropping a parent drops every descendant. |
| T6 | Roll-up, all dropped — parent becomes `dropped`, and **not** `done`. |
| T7 | Roll-up, mixed done+dropped, none open — parent becomes `done`, and **not** `dropped`. |
| T8 | Roll-up, one child still open — parent is neither. |
| T9 | Roll-up regression — a week with no dropped nodes produces byte-identical `done` roll-up to today. |
| T10 | `transferUnfinished()` skips dropped nodes. |
| T11 | `transferReusable()` copies a dropped reusable node with the flag cleared. |
| T12 | `moveNodeToNextWeek()` moves a dropped node with the flag cleared. |
| T13 | `getOverdueItems()` excludes dropped nodes. |
| T14 | `computeWeekStats()` — dropped stays in `total`, is absent from `done`, and lands in its own bucket. |
| T15 | Drop rate maths — `dropped / total`, and 0 dropped yields no row. |
| T16 | `_computeSummarySignature()` changes when a node is dropped. |
| T17 | Undo restores the pre-drop state, including timestamps. |
| T18 | Drive merge — last `_ts` wins on a concurrent done-vs-dropped edit. |
| T19 | i18n parity — every new key exists in both `en` and `cs`. |

Manual verification in the browser (per `CLAUDE.md`), light **and** dark: diagonal slash renders at all three view levels; the ⊘ badge does not push the label off-centre; the agenda Dropped group appears and hides correctly; the delete dialog's three buttons fit on mobile without wrapping.

---

## 10. Boundaries

**Always**

- Run `npm test`, `npm run validate` and `npm run csp` before considering a slice done.
- Keep every change inside `zenit-week.html`.
- Add both `en` and `cs` strings in the same edit.
- Use `textContent` for anything carrying a node label.
- Preserve D1 (mutual exclusion) at every write site, not just in `setStatus`.

**Ask first**

- Any change to `syncStatusUp`'s behaviour beyond §3.3.
- Adding a new CSS custom property or theme token rather than deriving from the branch colour.
- Any change to what Delete does, as opposed to what the dialog offers.
- Introducing a migration or touching `validateAndRepair()`.

**Never**

- `innerHTML` with user data; native `confirm()`/`alert()`/`prompt()`.
- Split the app into more files, or move logic into `sw.js`.
- Reuse Done's grey palette, horizontal strike-through, or the dashed stroke reserved for keyboard focus.
- Hide dropped nodes from the mind map.
- Bring dropped tasks forward in `transferUnfinished()`.
- Commit or push without asking.

---

## 11. Acceptance criteria

- [ ] `X` on a hovered node drops it; `X` again returns it to open.
- [ ] A dropped node shows branch colour at reduced opacity, a diagonal slash and a ⊘ badge — and is unmistakable from a done node at a glance, in both themes and at all three view levels.
- [ ] A dropped node never carries a horizontal strike-through.
- [ ] Dropping a parent drops its whole subtree; an all-dropped subtree rolls the parent up to dropped; a mixed done+dropped subtree rolls it up to done.
- [ ] Marking a dropped node done clears the drop, and vice versa, timestamps included.
- [ ] `Transfer Unfinished` does not bring dropped tasks into next week; `Transfer Reusable` and `Next week` both clear the flag.
- [ ] A dropped task never appears on the Overdue tab.
- [ ] The Agenda shows a `Dropped` group last, hidden when empty, with swipe-right to undrop.
- [ ] Stats shows a grey dropped band and a `Dropped` headline row; the row disappears in a week with nothing dropped.
- [ ] Completion % counts dropped as not-done — dropping tasks lowers it.
- [ ] The delete dialog offers `Drop` / `Vyřadit` alongside Delete, and no two buttons in it share a word.
- [ ] Undo restores a dropped task exactly.
- [ ] `npm test`, `npm run validate` and `npm run csp` all clean.

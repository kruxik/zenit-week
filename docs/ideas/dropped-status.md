# Dropped Status

## Problem Statement
Today a task that will not happen has only one exit: **Delete**. That erases it, so the week's record silently rewrites itself into "everything I kept was everything I planned". How might we let a user close a task as *decided against* — keeping it in the week's record and in the stats denominator — without confusing it with Done, with Unplanned, or with a genuine mistake that deserves deleting?

## Where it fits in the existing model

The app already carries two orthogonal axes:

| Axis | Question it answers | Values today |
|---|---|---|
| Provenance | Was it in the plan? | planned / `unplanned` |
| Outcome | What happened to it? | open / `done` |

**Dropped is a third value on the outcome axis, not a new axis.** Outcome becomes open / done / dropped. It stays orthogonal to `unplanned` — an unplanned task that arrived and then got dropped is a real and meaningful combination.

Delete keeps its own, now-sharper meaning:

- **Delete** — "this should never have been here" (typo, duplicate, mis-drop). No record.
- **Drop** — "this was real, I decided against it." Full record.

## Recommended Direction

### Data model

A `dropped: true` flag plus a `droppedAt` ISO timestamp on the node, mirroring the shape of `done`/`doneAt` and `unplanned`/`unplannedAt`.

- `dropped` and `done` are **mutually exclusive** — setting either clears the other, along with its timestamp.
- `dropped` is **independent of** `unplanned`. Both may be true.
- Counter nodes: dropping freezes `val` where it stands; the remaining `max - val` is recorded as never-happening rather than still-open.

`setStatus(id, status)` (`zenit-week.html:11129`) gains two branches, `'dropped'` and `'undropped'`, alongside the existing `done` / `undone` / `unplanned` / `planned` pairs. Each branch does what the existing ones do: set the flag and timestamp, `touchNode(id)`, `setDescendants(id, …)`, `syncStatusUp(id, 'dropped')`.

### Cascade rules

- **Down** (`setDescendants`, `zenit-week.html:11134`): dropping a parent drops the whole subtree, matching `done`.
- **Up** (`syncStatusUp`, `zenit-week.html:13306`): a parent becomes dropped only when **every** leaf below it is dropped.
- **Mixed subtree** — some children done, some dropped, none open: the parent becomes **done**, not dropped. Nothing is left open, and the parent did deliver something. Only an all-dropped subtree means the parent itself never happened.

### Stats

Dropped stays in the completion-% **denominator**. A week where you plan 20 and drop 8 does not get to report 100%. But dropped must not silently merge into "open", because "still could happen" and "will not happen" are different facts about the same week.

`computeWeekStats()` (`zenit-week.html:~13608`) currently splits leaves into four buckets (`plannedDone`, `plannedOpen`, `unplannedDone`, `unplannedOpen`). Dropped work is peeled out of the two `*Open` buckets into its own, so the bands become:

| Band | Color | Meaning |
|---|---|---|
| planned done | green, solid | delivered as planned |
| unplanned done | amber, solid | delivered, but not in the plan |
| planned open | green, faded | still live |
| unplanned open | amber, faded | arrived, still live |
| **dropped** | **grey/slate, faded** | closed, will not happen |

Grey, deliberately — red is already priority-critical, amber is already unplanned.

`STATS_SPLIT_BANDS` (`zenit-week.html:~13680`) is the single list that paints the donut, the CFD bands and the root completion ring, so adding one entry there keeps all three in agreement by construction. Whether dropped is one grey band or splits planned/unplanned like the others is an implementation call; one band is the simpler default, since the provenance of a dropped task is rarely the interesting part.

The genuinely new number this unlocks is **drop rate** — what share of the week you closed without doing. It is the one thing the current model cannot express at all.

**Drop rate is a fourth headline row, shown last**, built with the existing `_statsHeadline(labelKey, pct, rawA, rawB)` helper (`zenit-week.html:~13790`):

```
Plan completion        63%   (12 / 19)
Unplanned load         18%   (4 / 23)
Unplanned completion   75%   (3 / 4)
Dropped                17%   (4 / 23)   ← new
```

Denominator is `c.total`, matching how "Unplanned load" is computed, so the two read on the same scale. The row is guarded by a `hasDropped` check exactly as the unplanned rows are guarded by `hasUnplanned` — in a week where nothing was dropped, the row does not exist. No new component, no new layout.

`weekSignature()` (`zenit-week.html:~13590`) must include `n.dropped`, or the stats panel will not refresh when a task is dropped.

### Visual treatment in the mind map

The obvious treatments are all taken:

| Treatment | Already means |
|---|---|
| Grey fill + grey border + horizontal strike-through | Done (`--node-done-bg`, `zenit-week.html:232`; `text-decoration` at `:11839`) |
| Amber fill + bolt badge | Unplanned |
| Dashed stroke | Keyboard focus ring — explicitly reserved ("nothing else on the map is dashed", `zenit-week.html:3276`), plus coarse-pointer selection |
| Hatching | Unplanned, in the Stats legend |

**Chosen: diagonal slash, branch color kept.**

- Node keeps its **branch color**, dropped to roughly 45% opacity. Not grey — so it never reads as Done at a glance, and you can still see *which branch* bled.
- A single **diagonal line corner-to-corner across the node rect** (an SVG `line` in the node group, branch-colored). Done strikes the *text* horizontally; dropped strikes the *node* diagonally. Two different marks at two different scales.
- A **⊘ badge** in the existing badge row (same slot as the bolt / repeat / comment icons), so the state survives grayscale, color-blindness, and the zoomed-out Rocks view where a thin diagonal gets small. Its width must be factored into the badge-row `rightW` / `textX` centering math, the same as the comment badge.

Incoming edges mute exactly as they do for done nodes (`zenit-week.html:~12038`) — both are closed states, and inventing a second muted-edge style buys nothing.

Dropped nodes **stay on the map**. Hiding them would make Drop functionally identical to Delete, which is the thing this feature exists to avoid; and the view-level cycle (Sand / Pebbles / Rocks) is already the tool for map clutter if it ever becomes a real complaint.

### Transfer and movement

The whole point of dropped is that it does not come back. But "does not come back" must not become "this task can never recur again", so the three paths differ:

| Path | Behavior on a dropped node | Why |
|---|---|---|
| `transferUnfinished()` (`zenit-week.html:~10419`) | **Skips it.** The candidate filter `!n.done` becomes `!n.done && !n.dropped`. | This is precisely what Drop means. |
| `transferReusable()` (`zenit-week.html:~10590`) | **Copies it, clearing `dropped`/`droppedAt`.** | A weekly recurring task should not be killed forever by one bad week. Follows the existing pattern where transfer clears `unplanned`/`unplannedAt`. |
| `moveNodeToNextWeek()` (`zenit-week.html:~10725`) | **Moves it, clearing `dropped`/`droppedAt`.** | An explicit user move is a decision to re-plan it — the same reasoning the code already applies to `unplanned` at `:10755`. |

After any of these, re-sync the parents for the new property, alongside the existing `syncStatusUp(n.id, 'done')` / `'unplanned'` calls.

### Entry points

- **Context menu** — a new `ctx-dropped` item next to `ctx-done` / `ctx-undone` (`zenit-week.html:3898`), labelled with the state (see *Label form* below). Hidden for center and branch nodes, matching how the menu already hides inapplicable options.
- **No new "un-drop" menu item.** The existing **Undone / Nesplněno** item is the return path from *either* closed state — it already means "back to open", and the outcome axis has one open state with two ways into it. One label instead of two, and it is the honest description of what happens.
- **Hotkey `X`** on the hovered node — verified unused.
- **Delete confirm dialog** gains a second button, **Drop / Vyřadit**. `showAppConfirm` already supports this via its `secondaryLabel` / `onSecondary` parameters (`zenit-week.html:18894`), so no new dialog machinery is needed. Delete stays the primary (danger) action. Without this, habit means most users will keep deleting and never discover the feature.

  The button is a bare verb, not "Drop instead" — three buttons side by side already read as three alternatives, so "instead" adds length without adding meaning, and its Czech form ("místo toho") leaves the reader hunting for what *toho* refers to. The dialog body carries the explanation instead:

  ```
  Smazat úkol?
  Tato akce ho odstraní natrvalo.
  Vyřazený úkol zůstane v týdnu a započítá se do statistik.

  [ Zrušit ]   [ Vyřadit ]   [ Smazat ]
  [ Cancel ]   [ Drop ]      [ Delete ]
  ```

  Three distinct verbs, no word shared between two of them.

### Agenda view

A day tab renders three groups today, in this order (`zenit-week.html:~17272`):

```
Scheduled   3   renderGroup(pendingRows, 'pending', t('agenda.scheduled'))
Done        2   renderDoneSection(done) — chronological, swipe-right → undone
Any day     4   renderGroup(anyRows, 'anyday', t('agenda.anyDay'))
```

Dropped tasks get **a fourth group, rendered last** — after `Any day`, not directly under `Done`. Everything above it is still actionable; the dropped group is the only one that is not, so it belongs at the bottom of the tab rather than wedged into the middle of the live work.

```
Scheduled   3
Done        2
Any day     4
Dropped     1   ← new; hidden when count is 0, like Done
```

It uses the same `makeSectionDivider(labelText, count)` that the Done section uses (`zenit-week.html:~17139`). The i18n string is sentence case — `.today-done-divider` applies `text-transform: uppercase` (`zenit-week.html:1551`), so the label is stored as "Dropped" / "Vyřazeno", not shouted.

On the **Overdue tab** the layout is different — `pending` is grouped by weekday name instead. Dropped tasks must not appear there at all, which the `getOverdueItems()` fix below already handles.

Rows render at reduced opacity with the ⊘ badge. The diagonal slash is a mind-map mark and does not translate to a list row, so the badge plus opacity carries it here. Swipe-right **undrops**, mirroring the Done section's swipe-to-undone, so a mistaken drop is recoverable from the same surface that shows it.

Keeping them visible rather than hiding them matters: hiding would leave no way to notice or undo a mis-drop from the Agenda, which is where most day-to-day interaction happens.

**Required fix, independent of the above:** `getOverdueItems()` (`zenit-week.html:12738`) filters on `n.type !== 'activity' || n.done`. A dropped task would therefore nag as overdue forever. The guard becomes `!n.done && !n.dropped`. The unscheduled-items bucket immediately below it needs the same treatment.

**Note on stale docs:** `CLAUDE.md` describes a "Todo panel — sidebar listing all incomplete activity nodes across the week". No such panel exists in the code; the only `.app-panel` elements are `agenda-view`, `stats-panel`, `help-panel` and `comment-panel`. That line should be corrected independently of this feature.

### Free wins from existing infrastructure

- **Daily log** — `droppedAt` mirrors `doneAt`/`unplannedAt`, so dropped tasks appear in the day's log with their own badge using the existing `.daily-log-badge` pattern (`zenit-week.html:1590`). A record of *when* you gave up on something is genuinely useful reflection material.
- **Drive sync** — `dropped`/`droppedAt` live on the node object and `touchNode()` bumps `_ts`; last-`_ts`-wins merging handles it with no extra code.
- **Undo/redo** — `setStatus()` already calls `takeSnapshot()` on entry.

## Deliberately out of scope

- **Waiting / blocked flag** (listed in `NEXT`). It is a different axis — *blocked but alive* versus *closed and unsuccessful* — and it belongs in the open bucket, not a closed one. Shipping both at once multiplies the state matrix, the stats bands, and a visual vocabulary that is already crowded. Ship Dropped first, learn from it, then decide whether Waiting still earns its place.
- **Drop reasons / notes.** The existing comment field already covers "why did I drop this" for anyone who wants it. A dedicated reason picker is a bet on data nobody reviews.
- **Bulk-drop at week end.** Tempting, but it turns a considered decision into a chore-clearing swipe, which destroys the honesty of the drop-rate number. Revisit only if the per-node flow proves too slow in practice.

## Naming

**English: Dropped / Drop. Czech: Vyřazeno / Vyřadit.**

*Vyřadit* means "take out of the lineup" — the thing existed, it is simply out. That is exactly the Drop/Delete distinction. It also appears nowhere in the file today (`vyřa*` → zero hits), which the alternatives could not claim:

| Rejected | Why |
|---|---|
| Zrušeno / Zrušit | **Collides.** "Zrušit" is already every dismiss button in the app, including the delete dialog's own (`app-confirm.cancel`, `zenit-week.html:9673`). Two meanings, one word, same dialog. |
| Zahozeno / Zahodit | Reads as "throw away" — closer to Delete than to Drop, and harsher in tone than the English. |
| Odloženo / Odložit | Means *postponed*. Implies it comes back, which is the opposite of the whole feature. |
| Canceled (EN) | Fine in isolation, but the Stats row reads "Dropped", so the node menu and the stats panel would disagree. |
| Won't do (EN) | GitHub's phrasing. Precise, but reads as a sentence next to one-word items like Done and Unplanned. |

### Label form

The context menu is not mixed — it follows a rule, and Dropped must follow it too.

| Class | Label form | Examples |
|---|---|---|
| **A — state toggle** | the target *state*, as adjective/participle | Done / Undone · Hotovo / Nesplněno<br>Unplanned / Planned · Neplánované / Plánované<br>Reusable / Disposable · Opakované / Jednorázové<br>Priority Normal / High / Critical |
| **B — one-shot action** | imperative verb (Czech: infinitive) | Delete · Smazat<br>Rename · Přejmenovat<br>Reset · Resetovat<br>Clear the Week · Vymazat týden<br>Transfer Unfinished · Přenést nedokončené |

(Only two outliers exist: "Next week / Příští týden", a destination rather than a state, and "Comment / Komentář", which opens a dialog.)

Dropping is a state toggle, so it takes **both** forms — each in its own class:

| Surface | Class | English | Czech |
|---|---|---|---|
| Context menu item | A | Dropped | Vyřazeno |
| Agenda section divider | A | Dropped | Vyřazeno |
| Stats headline row | A | Dropped | Vyřazeno |
| Delete dialog button | B | Drop | Vyřadit |
| Return to open | A (existing) | Undone | Nesplněno |

Czech *Vyřazeno* and *Nesplněno* are both neuter participles, so the pair reads naturally. Neither says which closed state you came from — correct, since *Nesplněno* means "back to open" either way.

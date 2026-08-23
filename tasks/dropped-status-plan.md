# Plan — Dropped Status

Source spec: [`docs/specs/dropped-status.md`](../docs/specs/dropped-status.md)
Source idea: [`docs/ideas/dropped-status.md`](../docs/ideas/dropped-status.md)
Task list: `tasks/dropped-status-todo.md` · Branch: `feature/dropped-status` · Single file: `zenit-week.html`

## Principles

- **Vertical slices.** Each slice delivers one complete path a user or a test can exercise end to end — not a horizontal layer of "all the data model", then "all the CSS".
- **Single-file policy.** Everything lands in `zenit-week.html`. `sw.js` is not touched.
- **Each slice ships with:** code + EN/CS i18n (where user-visible) + vitest coverage. `npm test`, `npm run validate` and `npm run csp` green before commit.
- **One commit per slice**, asked for before it happens.

## Dependency graph

```
        ┌──────────────────────────────┐
        │ S1  Core state               │  setStatus, cascade, roll-up
        │     (logic only, no UI)      │  ← the only change to existing behaviour
        └──────────────┬───────────────┘
                       │  everything below depends on S1
       ┌───────────────┼───────────────┬───────────────┐
       ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ S2 Mind map │ │ S3 Lifecycle│ │ S4 Stats    │ │ S5 Agenda   │
│  + entry    │ │  transfers  │ │  bands +    │ │  4th group  │
│  points     │ │  + overdue  │ │  drop rate  │ │  + undrop   │
└──────┬──────┘ └─────────────┘ └─────────────┘ └─────────────┘
       │
       ▼
┌─────────────┐
│ S6 Delete   │  needs S2's i18n + the state to drop into
│    dialog   │
└──────┬──────┘
       ▼
┌─────────────┐
│ S7 Polish   │  daily log badge, help legend, CHANGELOG, ship gate
└─────────────┘
```

S3, S4 and S5 are mutually independent — after S1 they can land in any order, or in parallel. S2 is sequenced before S6 only because S6 reuses its translation keys and its ⊘ icon.

## Why S1 is alone and first

§3.3 of the spec is the only place existing behaviour changes. `syncStatusUp()` is generic (`siblings.every(s => s[prop])`) and cannot express "some done, some dropped, none open → parent done". Replacing that predicate touches the roll-up for *every* week, including weeks with no dropped tasks at all.

So S1 lands by itself, with `tests/status-propagation.test.js` and the rest of the suite unchanged as the regression net, and with T9 pinning the no-dropped-nodes case to today's exact output. Nothing visual ships until that gate is green.

## Slices

### S1 — Core state (logic only)

`dropped`/`droppedAt` on the node; `setStatus` gains `'dropped'`/`'undropped'`; cascade down via `setDescendants`; roll-up rewrite per §3.3; mutual exclusion D1; counter freeze D3.

No UI. After this slice a dropped node is indistinguishable on screen — that is intentional, and it is why S1 is verified by tests rather than by eye.

**Risk:** the roll-up rewrite. **Mitigation:** T9 plus the ten existing suites listed in spec §9, all unchanged.

### S2 — Mind map + entry points

Branch colour at ~45% opacity, diagonal slash, ⊘ badge, edge muting, hotkey `X`, `ctx-dropped` menu item, `ctx-undone` shown for dropped nodes, EN/CS strings.

**Risk:** the badge width feeds the `rightW` / `textX` centering maths — the same trap the comment badge hit. **Mitigation:** explicit check that a dropped node's label stays centred, at all three view levels, with and without the other badges present.

### S3 — Lifecycle: transfers + overdue

`transferUnfinished()` skips dropped; `transferReusable()` and `moveNodeToNextWeek()` clear the flag; `getOverdueItems()` and the unscheduled bucket exclude dropped.

### S4 — Stats

New bucket in `computeWeekStats()`, grey band in `STATS_SPLIT_BANDS`, `Dropped` headline row guarded by `hasDropped`, `_computeSummarySignature()` includes `n.dropped`.

**Risk:** forgetting the signature — the panel silently fails to refresh, which reads as "stats are wrong" rather than "stats are stale".

### S5 — Agenda

Fourth group rendered last, after `Any day`. Divider via `makeSectionDivider`, sentence-case label, hidden when empty, rows at reduced opacity with the ⊘ badge, swipe-right to undrop.

### S6 — Delete dialog

`secondaryLabel` / `onSecondary` on the existing `showAppConfirm`, body copy explaining what a drop preserves, three buttons sharing no word between them.

**Risk:** mobile width — three buttons must not wrap.

### S7 — Polish and ship gate

Daily-log badge, Help legend entry, CHANGELOG, final `npm run csp`, full manual pass in both themes.

## Checkpoints

| After | Gate |
|---|---|
| **S1** | Full suite green with the roll-up rewritten. **Stop and report** — this is the regression cliff; nothing else proceeds until it is clean. |
| **S2** | Human eyes on the visual language, light and dark, all three view levels. **Stop and get approval** — every later slice reuses this vocabulary, so changing it after S5 means redoing S5. |
| **S4** | Numbers verified against a hand-computed week. Percentages are the feature's whole point. |
| **S7** | Ship gate: `npm test`, `npm run validate`, `npm run csp`, manual pass both themes and mobile width. |

## Out of scope

Waiting/blocked flag, drop reasons, bulk-drop, any change to what Delete does. See spec §1.

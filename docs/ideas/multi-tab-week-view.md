# Multi-tab: view (and edit) a second week on monitor 2

## Problem Statement
How might we let a second browser tab display — and freely edit — a different
week, live, while the first tab plans the current week, without the per-tab
in-memory copies clobbering each other or deadlocking IndexedDB? And without the
intrusive "already open in another tab" block, which is itself bad UX.

## Recommended Direction (Option B — Local Sync Peer)
Drop the app-wide single-tab block entirely. Treat every other tab as a local
sync peer — the same role another device plays over Google Drive today.

On `saveWeek(wk)`, broadcast `{type:'week-saved', wk, crdtVersion}` over the
existing `tabChannel` BroadcastChannel. Any tab currently showing `wk` reloads
that record from the SHARED IndexedDB and runs the existing
`mergeWeekData(localInMemory, idbRecord)` CRDT — last-write-wins per node by
`_ts`, union tombstones, tree rebuild — then does a surgical re-render.

No new conflict model. The multi-tab problem is identical to the Drive-sync
problem (two mutators of one week, reconcile by `_ts`); we point the proven
engine at a local transport instead of the network.

Why this matches the user's instinct: **never block the user; let the data heal
itself.** Full editing in every tab, and it stays safe.

- **Different weeks per tab** (the real workflow — plan this week, glance at last
  week): the tabs never touch the same record. Conflict-free, trivially safe.
- **Same week in both tabs**: `mergeWeekData` reconciles it, exactly as two
  devices on Drive do today.

## Key Assumptions to Validate
- [ ] `mergeWeekData(localInMemory, idbRecord)` behaves correctly with a local
      (non-Drive) record — vitest case feeding two divergent copies of a week.
- [ ] A merge arriving mid-edit doesn't clobber an uncommitted local change or
      corrupt the per-tab undo/redo stack — test a broadcast landing while a node
      is `_editing` and while an undo/redo stack is half-built. **This is the real
      risk — timing, not the merge math.**
- [ ] IndexedDB `onblocked` no longer fires once the app-wide block is removed
      (`DB_VERSION` is constant, so upgrades — its only trigger — don't occur in
      normal use; confirm across a deploy/refresh).
- [ ] BroadcastChannel signalling survives tab close & crash (release/announce on
      `pagehide`/`visibilitychange`; treat silence as fine — IDB is the truth).

## MVP Scope
IN:
  - Remove the app-wide block overlay; keep `tabChannel` as the message bus.
  - `saveWeek` broadcasts `{wk, crdtVersion}` after persisting.
  - Tabs showing `wk` reload that record from shared IDB, run `mergeWeekData`,
    surgical re-render.
  - Guard the in-flight cases: don't apply a remote merge while a node is
    `_editing`; reconcile the undo/redo stack sensibly after a merge.
  - "Open previous week" toolbar action → new tab pre-scoped to the prev week.

OUT:
  - SharedWorker / single-source-of-truth rewrite.
  - Leader/follower writer election.
  - Cross-DEVICE realtime beyond what Drive already provides.

## Not Doing (and Why)
- SharedWorker single-source-of-truth — big rewrite of the persistence layer,
  fights the single-file vanilla ethos; reusing `mergeWeekData` gets us there
  far cheaper.
- A second conflict-resolution model — `mergeWeekData` already does LWW-by-`_ts`;
  a parallel model would risk divergence between the Drive and local paths.
- Keeping any blocking overlay — intrusive blocking is the bad UX we're removing,
  not relocating.

## Open Questions
- Per-tab undo after a remote merge: keep the local stack, or invalidate it when a
  remote merge lands on the current week?
- Visual signal that another tab just changed the week you're viewing — silent
  re-render, subtle flash, or a small "updated" cue?
- Should the 10s Drive-sync debounce and the new local broadcast share timing, or
  fire independently (local broadcast immediate, Drive debounced)?
```

## Effort & Risk
Not an app rewrite — a contained change to the save/load plumbing (remove lock,
add broadcast, reload-and-merge on signal, guard mid-edit/undo). The hard part is
testing timing edge cases; the scary piece (conflict resolution) is reused, not
written. **Medium effort, low-to-medium risk.**

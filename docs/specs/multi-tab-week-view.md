# Spec — Multi-tab editing (Option B: local sync peer)

Status: Draft · Feature spec (not a project spec — commands/structure/style live
in `CLAUDE.md`). Companion idea one-pager: `docs/ideas/multi-tab-week-view.md`.

## 1. Objective

Let a user open Zenit Week in multiple browser tabs at once (same browser =
shared IndexedDB), edit freely in every tab, and never see a blocking overlay.
Concurrent edits to the same week reconcile automatically and without data loss.

Target user: a single person planning across two monitors — e.g. drafting the new
week in tab A while viewing/adjusting last week in tab B.

Success = the "Application Blocked" overlay is gone, two tabs editing two
different weeks are fully independent, and two tabs editing the *same* week
converge to a merged, lossless result.

### Why this is small
The conflict engine already exists for Google Drive sync and is reused verbatim:
- `mergeWeekData(local, remote)` — CRDT, LWW per node by `_ts`, union tombstones,
  tree rebuild.
- `applyRemoteMerge` → `_commitRemoteMerge` — write IDB, re-render only if content
  changed (`_weekContentSig`), update sync state.
- `beginAtomicOp` / `endAtomicOp` / `isAtomicOpActive` / `pendingRemoteMerge` /
  `_flushPendingMerge` — already defer a remote merge while an edit is in flight.

A peer tab is just another "remote." The new work is the **transport** (a
BroadcastChannel signal + reload) plus loop/echo suppression — not a new model.

## 2. Behavior / Acceptance Criteria

### A. Remove the block
- [ ] Delete the single-tab enforcement: no `ping`/`pong` → `showBlockedOverlay()`
      path, no block on `takeover`. Opening a 2nd tab loads normally.
- [ ] `tabChannel` (`BroadcastChannel('zenit-week-tabs')`) is retained and
      repurposed as the change-signal bus.
- [ ] The `#single-tab-overlay` element and its i18n keys are removed (or left
      dead only if removal is risky — prefer removal).

### B. Broadcast on save
- [ ] After a successful `saveWeek(wk, data)` IDB write, broadcast
      `{ type:'week-saved', wk, sig }` where `sig` is the content signature of the
      persisted record (reuse `_weekContentSig` or `crdtVersion`).
- [ ] Each tab has a stable per-tab id (e.g. `genId()` at startup) included as
      `origin` so a tab can ignore its own echoes.

### C. Receive and merge
On `week-saved` for `wk` from another origin:
- [ ] If `wk !== currentWeekKey` and the tab isn't holding `wk` in memory → no-op
      (IDB already holds the peer's write; nothing displayed to refresh).
- [ ] If `wk === currentWeekKey`:
  1. `remoteData = await loadWeekIDB(wk)` (the peer's just-saved record).
  2. If `_weekContentSig(remoteData) === _weekContentSig(weekData)` → no-op
     (already converged; prevents ping-pong).
  3. `merged = mergeWeekData(structuredClone(weekData), remoteData)`.
  4. `applyRemoteMerge(wk, merged, json, hash, /*scheduleUpload*/ false, remoteData)`
     — reuses the existing atomic-op deferral and no-op-render guard.
- [ ] The merge path must **re-broadcast only if it changed the record** (merged
      sig ≠ remote sig), and that re-broadcast must not re-trigger the originator
      into an infinite loop (sig-equality guard in step C.2 terminates it).

### D. Mid-edit / undo safety (the real risk)
- [ ] A `week-saved` arriving while a node is `_editing` (active rename) must NOT
      discard the in-progress edit. Reuse `isAtomicOpActive()` deferral — confirm
      label edits are wrapped so `pendingRemoteMerge` holds until `commitEdit`.
- [ ] A merge that lands on the current week after the user has built an undo
      stack must leave undo/redo in a defined state. **Decision needed (Open Q1)** —
      default: keep the local undo stack as-is; a merged change is a new state, not
      an undoable local action.
- [ ] No merge is applied between a structural mutation and its `saveWeek` (the
      `beginAtomicOp`/`endAtomicOp` window already covers multi-step ops).

### E. Lifecycle
- [ ] Tab close/crash requires no cleanup: IndexedDB is the source of truth, and
      signals are fire-and-forget. A missed broadcast self-heals on the next save
      or on Drive poll.
- [ ] Works with Drive sync on: a local merge that changes content sets
      `scheduleUpload` so the change still propagates to Drive (mirror the existing
      `_commitRemoteMerge` logic; local broadcast fires immediately, Drive stays
      10s-debounced).

## 3. Out of Scope
- SharedWorker / single-source-of-truth rewrite.
- Leader/follower writer election.
- Cross-device realtime beyond existing Drive sync.
- Any blocking/lock UI — explicitly being removed, not relocated.

## 4. Testing Strategy
Automated (vitest — data logic):
- [ ] `mergeWeekData` fed two divergent copies of one week (disjoint edits) →
      union, no loss.
- [ ] Conflicting edit to the *same* node → higher `_ts` wins.
- [ ] Delete in tab A + edit in tab B of same node → tombstone wins (deletion
      sticks).
- [ ] Sig-equality guard: applying a remote record identical to local is a no-op
      (no re-broadcast, no re-render).
- [ ] Deferral: a merge requested while `isAtomicOpActive()` is queued into
      `pendingRemoteMerge` and flushed by `endAtomicOp`.

Manual (two real tabs, per `CLAUDE.md` testing notes):
- [ ] Tab A = current week, Tab B = previous week: edit both, neither disturbs the
      other; B reflects A's change to B's week live if A ever touches it.
- [ ] Both tabs on the same week: add nodes in each → both converge.
- [ ] Rename a node in A while a save from B lands → A's typing is not lost.
- [ ] Undo in A after a merge from B → defined, non-destructive behavior.
- [ ] Refresh / deploy with two tabs open → no IndexedDB `onblocked` deadlock.

## 5. Boundaries
Always:
- Reuse `mergeWeekData` / `applyRemoteMerge` — do not author a second conflict model.
- Keep everything in `zenit-week.html` (single-file policy).
- Use the custom confirm dialog pattern if any prompt is ever needed (none expected).

Ask first:
- Undo-after-merge semantics (Open Q1) before implementing D.
- Any change to the on-disk week record shape (`crdtVersion`, `tombstones`, `_ts`)
  — it's shared with the Drive format.

Never:
- Reintroduce a blocking overlay or a global single-tab lock.
- Apply a remote merge over an in-flight `_editing` node without the atomic-op guard.
- Broadcast user-controlled strings as executable/`innerHTML` content (XSS rule
  still applies; signals carry only `wk`, `sig`, `origin`).

## 6. Open Questions
1. **Undo after a remote merge** — keep local stack untouched (default), or clear
   redo / snapshot the merged state? Pick before coding section D.
2. **Visual cue** when another tab changed your current week — silent re-render
   (default), subtle flash, or a small "updated" toast?
3. **Signal payload** — is `_weekContentSig` enough, or also carry `crdtVersion`
   for cheap pre-load dedup before hitting IDB?
```

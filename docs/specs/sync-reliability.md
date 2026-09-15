# SPEC — Sync Reliability

> Source: incident analysis 2026-09-15 (phone restamped every node of week 2026-38 at 06:30:17.473Z, then won LWW against the desktop's evening work).
> Branch: `main` (small, independent fixes — no feature branch unless asked)
> Scope: Drive sync only. No visual change anywhere. Data model gains one bookkeeping field (`_posTs`).

---

## 1. Objective

Make a stale device unable to overwrite fresher work on another device, and close the silent stalls that let a device sit on stale data without saying so.

**Success:** a pan from the root node, a node drag, or an undo on a device that has not pulled the latest week never changes `done`, `dropped`, `label`, `priority`, day tags or any other content field on another device. A device never marks a remote revision as reconciled unless it actually merged it. A week created on two devices at the same time converges on one Drive file.

### Non-goals

| Excluded | Why |
|---|---|
| Repairing already-duplicated Drive files (`zenit-week-2026-16.json` exists twice) | Historic. The user has said the old data does not matter. Only prevent new duplicates and make every device pick the same copy deterministically. |
| Field-level CRDT for every node property | Overkill. Two timestamps — content and layout — cover every real conflict the app produces. |
| Removing the undo force-push | Separate concern. This spec only narrows what an undo restamps. |
| `fetch keepalive` at teardown | A week file is ~75 KB; `keepalive` bodies are capped at 64 KB. The service-worker queue already exists and is conflict-safe; use it. |

---

## 2. Root cause of the incident

`mergeWeekData` resolves each node by last-write-wins on `node._ts`. `touchNode(id)` sets `_ts = Date.now()` and is called for **layout** changes as well as content changes:

| Site | What it changes | Nodes stamped |
|---|---|---|
| `pointerup` handler, `panningFromCenter` branch (`CENTER_CLICK_SLOP_PX` exceeded) | `offX`/`offY` = 0 on every node ("recenter all") | **every node in the week** |
| `handleNodeDrop`, non-rebind path | `offX`/`offY` of the dragged node, offsets of all descendants, `children` order of the parent, `side` of a branch | dragged node + subtree + parent |
| `maybeFlipDraggedBranch` | `side` of a branch, offsets of its subtree | branch + subtree |
| `_applySnapshot` (undo / redo) | restores a whole week | **every node in the snapshot** |

On a device holding a stale copy, any of these promotes the stale copy of every touched node to "newest". The next pull-merge-push then uploads stale content as the winner and every other device adopts it. On touch, a pan gesture that starts on the root node hits the first row silently.

---

## 3. Data model

One new per-node bookkeeping field:

```
_posTs   // epoch ms — last change of offX / offY / side. Same role as _ts, layout only.
```

- Missing `_posTs` reads as `0` (`migrateCrdt` backfills it, like `_ts`).
- Stripped from `_weekContentSig` exactly as `_ts` is — it is bookkeeping, not content.
- Never exported into the user-facing meaning of a node; never rendered.

`_ts` keeps its meaning — **content** changed — and is no longer touched by layout operations.

---

## 4. Behaviour

### 4.1 Two stamps, two merges (fix 1)

- New helper `touchLayout(id)`: sets `_posTs = Date.now()`. Does **not** touch `_ts`, does **not** clear `_demo`.
- `touchNode(id, opts)` is unchanged and is now called **only** for content changes.
- `mergeWeekData` step 2 (per-node LWW by `_ts`) is unchanged for the node body. Immediately after it, for every id present on **both** sides, overlay `offX`, `offY`, `side` from the side with the higher `_posTs`; tie → remote (same convention as `_ts`). A node present on one side only keeps whatever it has.
- `syncBranchConfig` already re-reads `side` from the merged node; nothing else changes downstream.

Call sites that switch from `touchNode` to `touchLayout`:

| Site | Change |
|---|---|
| `pointerup` recenter-all (`panningFromCenter`, every non-center node) | `touchLayout(n.id)` |
| `handleNodeDrop`, non-rebind path: the dragged node, `clearDescendantOffsets`, the branch `side` change, and the `touchNode(node.parent)` after the `children` reorder | `touchLayout` for all four. Children order merges by document `savedAt` (step 4 of `mergeWeekData`), not by `_ts`, so the parent needs no content stamp. |
| `maybeFlipDraggedBranch`: branch and its descendants | `touchLayout` |
| `applyAutoLayout` | currently stamps nothing; leave as is |

Call sites that **keep** `touchNode` (content): `handleNodeDrop` rebind path (parent / branch / `inbox` change), `setStatus`, `setDescendants`, `setPriorityDescendants`, `commitEdit`, `applyMagicLabel`, `setActivityDays`, tick / counter helpers, `moveNodeToNextWeek`, `_performDelete`, `toggleReusableNode`, `syncStatusUp`, comments, quick add, `renumberTickChildren`, `relabelDemoNodes`.

### 4.2 No recenter-all from a touch pan (fix 2)

In the `pointerup` handler's `panningFromCenter` branch: when `e.pointerType === 'touch'`, a pan that started on the root is a pan and nothing else — no snapshot, no offset reset, no save. Mouse and pen keep today's behaviour (drag the root → recenter all). The sub-slop click path (open Stats) is unchanged for every pointer type.

### 4.3 Undo restamps only what it changes (fix 3)

In `_applySnapshot`, replace the blanket `for (const n of restoredPrimary.nodes) n._ts = tsNow` with a per-node comparison against the live node of the same id (live = `weekData.nodes` for the displayed week, else the IDB record — the array `livePrimaryNodes` already exists there):

- Node absent from live → `_ts = tsNow`, `_posTs = tsNow` (it is being re-created; it must win).
- Content differs (any field other than `_ts`, `_posTs`, `_editing`, `offX`, `offY`, `side`, `children` — compare with a sorted-key JSON of the remaining fields) → `_ts = tsNow`.
- Only `offX` / `offY` / `side` differ → `_posTs = tsNow`, keep live `_ts`.
- Nothing differs → copy the live node's `_ts` and `_posTs` (the snapshot's stamps are older than live and must not roll back).

`_preserveRemoteNodes`, `_tombstoneRemovedNodes` and `_undoRedoForcePush` are unchanged. The next-week half of `_applySnapshot` (the `nextAdded` re-insert with `_ts: tsNow`) is unchanged: those nodes are re-created, so the stamp is right.

### 4.4 One Drive file per week (fix 4, prevention only)

Every name lookup resolves duplicates with one rule so every device picks the same copy:

> **Survivor** = the file with the newest `modifiedTime`; tie → lexically smallest `id`.

- `findDriveFileId`, `getDriveFileId` (search half) and `listAllDriveWeekFiles` request `files(id,name,modifiedTime,appProperties)` and apply the rule when a name returns more than one file. `listAllDriveWeekFiles` pushes **one** entry per week key (the survivor) so `driveMap` and `driveFileIdCache` cannot flip between copies.
- `getDriveFileId` create half: after the `POST`, run the name query once more. If it now returns more than one file, apply the rule. If the survivor is not the file just created, **delete the file just created** (it is the empty placeholder this device made seconds ago — nothing is lost) and cache the survivor. If the delete fails, still cache the survivor; the other copy is inert because no device will resolve to it.
- Nothing merges, repairs or deletes pre-existing duplicates. Week 2026-16 keeps both files; both devices simply agree on the same one from now on.

### 4.5 "Seen" only when applied (fix 5)

`syncWeekFromDrive` gains an option `{ seenHash }` and a return value:

| Return | Meaning |
|---|---|
| `'applied'` | merge committed to IDB (and to `weekData` when displayed) |
| `'deferred'` | merge parked in `pendingRemoteMerge` behind an open editor / atomic op |
| `'unchanged'` | `304`, or empty file, or malformed remote |
| `'failed'` | `401`, exhausted retries, id lookup failure, `_undoRedoForcePush` guard |

Inside `syncWeekFromDrive`, right after the merge is applied **or deferred**, if `seenHash` was given: `lastSeenRemoteHash.set(wKey, seenHash)`. A deferred merge counts as seen because `pendingRemoteMerge` owns it until `_flushPendingMerge` runs; a newer pull overwrites it, never loses it.

Callers stop setting `lastSeenRemoteHash` themselves:

- `pollDriveMeta` week loop and `pollDriveChanges` week branch: pass `{ seenHash: remoteHash }`, drop the `lastSeenRemoteHash.set` after the call.
- `initDriveSync` step 3: keep the direct `lastSeenRemoteHash.set` **only** for the "identical hash" branch. For `toMerge` weeks, pass `{ seenHash: driveEntry.contentHash }` through both step 4a and step 4b calls. Step 0's pull of the shown week passes nothing (the hash is not known yet); step 4a's `continue` for the shown week is unchanged, and step 3 will set the hash for it only if identical — otherwise the next poll reconciles it, which is the correct outcome.
- Colors and schedule keep their current `lastSeenRemote…` handling; out of scope.

### 4.6 No silent stall (fix 6)

**On `visibilitychange` → `hidden`** (the existing listener that stops the poll and flushes), before `flushAllPendingSyncToDrive()`:

1. If an inline editor is open (`editState` set), `commitEdit()` — the same thing the input's `blur` does; mobile keyboards close on hide anyway.
2. If a map drag is in flight (`dragState.activeNodeId`), abort it exactly as the `pointercancel` handler does (reuse that code path: extract it into a function both call).
3. `_atomicOpsDepth = 0`, then `_flushPendingSync()` — the deferred merge and the parked upload keys are released. A gesture cannot survive the page being hidden, so a depth left above zero here is a leak, not an operation.

**At teardown** (`pagehide` / `beforeunload`, `_flushOnTeardown`): stop calling `syncWeekToDrive` — its pull-merge-push cannot finish once navigation starts. Instead, for every pending week (the same set `flushAllPendingSyncToDrive` builds), `_offlineUploadQueue.add(wk)` + `_persistOfflineUpload(wk)`, exactly as the offline branch already does, and `_registerUploadSync()`. The worker's `canPushEntry` guard keeps this conflict-safe: it only pushes when Drive still holds a revision this device reconciled. `visibilitychange` → `hidden` keeps the direct `syncWeekToDrive` flush (the page is still alive there).

**At boot**, after `initDriveSync` resolves without error: `_clearOfflineUploadQueue()`. Init has just reconciled every week, so a queued entry is stale, and on browsers without Background Sync (Safari, Firefox) it would otherwise sit forever.

---

## 5. Invariants

| # | Invariant |
|---|---|
| I1 | A layout-only operation never changes `_ts` on any node. |
| I2 | After `mergeWeekData(local, remote)`, for every id on both sides: content fields come from the higher `_ts`, `offX`/`offY`/`side` from the higher `_posTs`, ties → remote for both. |
| I3 | `_weekContentSig` is identical for two records that differ only in `_ts` / `_posTs`. |
| I4 | `_applySnapshot` leaves `_ts` and `_posTs` untouched on a node whose restored copy equals its live copy. |
| I5 | Two devices resolving the same file name from the same listing pick the same file id. |
| I6 | `lastSeenRemoteHash` for a week is only ever set to a hash whose content was merged (or parked in `pendingRemoteMerge`). |
| I7 | After `visibilitychange` → `hidden`, `_atomicOpsDepth === 0`, `pendingRemoteMerge === null`, `_pendingUploadKeys.size === 0`. |

---

## 6. Tests

All in `tests/`, run by `npm test`. Existing files to extend are named; new files where none fits.

- `crdt.test.js` — I2 with four cases: local newer content + remote newer position; the reverse; both newer on the same side; one side missing `_posTs` (legacy → 0). Plus I3.
- New `layout-stamps.test.js` — `touchLayout` sets `_posTs` only; recenter-all stamps `_posTs` on every non-center node and leaves every `_ts` unchanged (I1); `migrateCrdt` backfills `_posTs = 0`.
- `history.test.js` — I4: undo over an unchanged week leaves stamps alone; undo that reverts one node's `done` restamps only that node's `_ts`; undo that reverts one node's offset restamps only its `_posTs`.
- `drive-file-id-cache.test.js` — I5: the survivor rule on a two-file listing (newer `modifiedTime` wins; tie by id); `listAllDriveWeekFiles` emits one entry per week; the create path deletes its own placeholder when a second query shows an older survivor.
- `sync-convergence.test.js` — I6: a `syncWeekFromDrive` that returns `'failed'` leaves `lastSeenRemoteHash` unset; `'applied'` and `'deferred'` set it.
- New `visibility-flush.test.js` — I7 with a stuck `_atomicOpsDepth` and a parked upload key; teardown parks pending weeks in the offline queue instead of calling `syncWeekToDrive`.
- `npm run validate` and `npm run csp` after the last edit (inline-script hash).

Manual (phone + desktop, both signed in): drag a node on the phone while the desktop marks the same node done → desktop keeps done, phone adopts done and keeps its position. Pan from the root on the phone → map pans, nothing saved.

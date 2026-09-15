# TODO — Sync Reliability

Spec: `docs/specs/sync-reliability.md` · Branch: `main`

Order: **S1 first** (it is the incident). S2–S6 are independent of each other once S1 is in. Check off only when AC + verification both pass. Never commit — report the commit one-liner and ask.

---

## S1 — Layout stamp (`_posTs`) ← the incident

- [x] T1.1 — `touchLayout(id)` next to `touchNode`: `_posTs = Date.now()`, nothing else.
- [x] T1.2 — `migrateCrdt`: backfill `_posTs = 0` when not a number.
- [x] T1.3 — `_weekContentSig`: strip `_posTs` alongside `_ts` / `_editing`.
- [x] T1.4 — `mergeWeekData`: after the `_ts` LWW pass, overlay `offX` / `offY` / `side` from the higher `_posTs` for ids on both sides; tie → remote.
- [x] T1.5 — Switch to `touchLayout`: `pointerup` recenter-all; `handleNodeDrop` non-rebind path (dragged node, `clearDescendantOffsets`, branch `side`, parent after `children` reorder); `maybeFlipDraggedBranch` (branch + descendants). Rebind path keeps `touchNode`.
- [x] T1.6 — Tests: `crdt.test.js` (I2, I3), new `layout-stamps.test.js` (I1, backfill).

**AC:** I1–I3 hold. `npm test` green, `tests/crdt.test.js` existing cases unmodified.

### ⛔ CHECKPOINT 1 — report before S2

---

## S2 — No recenter-all from touch

- [x] T2.1 — `pointerup` `panningFromCenter` branch: `e.pointerType === 'touch'` → plain pan (no snapshot, no reset, no save). Mouse / pen unchanged. Sub-slop click unchanged.
- [x] T2.2 — Test in `layout-stamps.test.js` or `center-node.test.js`: touch pan from root leaves every `offX` / `offY` and `_posTs` alone.

**AC:** pan from root on touch saves nothing.

---

## S3 — Undo restamps only changed nodes

- [x] T3.1 — `_applySnapshot`: per-node compare against `livePrimaryNodes` per spec §4.3 (absent → both stamps now; content differs → `_ts`; layout differs → `_posTs`; equal → copy live stamps).
- [x] T3.2 — `history.test.js`: I4 three cases.

**AC:** undo over an unchanged week changes no stamp.

---

## S4 — One Drive file per name (prevention only)

- [x] T4.1 — Shared `pickDriveSurvivor(files)`: newest `modifiedTime`, tie → smallest `id`.
- [x] T4.2 — `findDriveFileId`, `getDriveFileId` search half, `listAllDriveWeekFiles`: request `modifiedTime`, apply T4.1; listing emits one entry per week key.
- [x] T4.3 — `getDriveFileId` create half: re-query after `POST`; if the survivor is another file, `DELETE` the placeholder just created (ignore failure), cache the survivor.
- [x] T4.4 — `drive-file-id-cache.test.js`: I5 cases.

**AC:** no repair of existing duplicates; both devices resolve `zenit-week-2026-16.json` to the same id.

---

## S5 — Seen only when applied

- [x] T5.1 — `syncWeekFromDrive({ force, seenHash })` returns `'applied' | 'deferred' | 'unchanged' | 'failed'`; sets `lastSeenRemoteHash` itself on applied / deferred when `seenHash` given.
- [x] T5.2 — `pollDriveMeta`, `pollDriveChanges`: pass `seenHash`, drop their own `lastSeenRemoteHash.set`.
- [x] T5.3 — `initDriveSync` step 3: direct set only on the identical-hash branch; `toMerge` weeks pass `seenHash` in 4a and 4b.
- [x] T5.4 — `sync-convergence.test.js`: I6.

**AC:** a `401` on pull leaves `lastSeenRemoteHash` unset; the next poll re-pulls.

---

## S6 — No silent stall

- [x] T6.1 — Extract the `pointercancel` drag-abort into `abortActiveDrag()`; call it from the handler.
- [x] T6.2 — `visibilitychange` → `hidden`: `commitEdit()` if `editState`; `abortActiveDrag()`; `_atomicOpsDepth = 0`; `_flushPendingSync()`; then the existing flush.
- [x] T6.3 — `_flushOnTeardown`: park pending weeks into the offline queue (`_offlineUploadQueue.add` + `_persistOfflineUpload` + `_registerUploadSync`) instead of `syncWeekToDrive`. Hidden path keeps `syncWeekToDrive`.
- [x] T6.4 — Boot: `_clearOfflineUploadQueue()` after a successful `initDriveSync`.
- [x] T6.5 — New `visibility-flush.test.js`: I7; teardown parks instead of uploading.

**AC:** I7 holds; teardown makes no `PATCH` from the page.

---

## Final

- [x] `npm test`, `npm run validate`, `npm run csp` green.
- [x] CLAUDE.md: add `_posTs` to the data model block and `touchLayout` to Key Functions.
- [x] One commit one-liner per slice, ask before committing.

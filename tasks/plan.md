# Plan — Multi-tab editing (Option B: local sync peer)

Source spec: `docs/specs/multi-tab-week-view.md` · Idea: `docs/ideas/multi-tab-week-view.md`
Mode: vertical slices — each task is one complete path (signal → merge → render),
not a horizontal layer. All work stays in `zenit-week.html` (single-file policy).

## Code anchors (verified)
- Single-tab enforcement: `zenit-week.html:3729–3759` (BroadcastChannel
  `ping`/`pong`/`takeover` → `showBlockedOverlay`).
- Overlay markup `#single-tab-overlay`: `:2988–2994`; styles `:2900–2926`.
- **Two** overlay callers: proactive lock (`:3742`,`:3745`) AND `onDbBlocked`
  (`:3767` ← IDB `request.onblocked` `:3784`). Only the proactive one is removed.
- `saveWeek`: `:6678–6696` (writes IDB, then `scheduleDriveSync`).
- Reused merge engine: `mergeWeekData` `:5068`, `applyRemoteMerge` `:5156`,
  `_commitRemoteMerge` `:5165`, `_flushPendingMerge` `:5194`, `isAtomicOpActive`
  `:5225`, `pendingRemoteMerge`, `_weekContentSig` `:5038`.
- Edit lifecycle already wraps `beginAtomicOp()` (`:9108`) → renames defer merges.
- `genId()` for a per-tab id; `currentWeekKey` global `:5854`.

## Dependency graph
```
T1 (retarget lock → DB-only failsafe)        [foundation]
        │
        ▼
T2 (per-tab origin id + broadcast on save)
        │
        ▼
T3 (receive → merge current week, loop-safe)  ◀── core slice
        │
   ┌────┼─────────┐
   ▼    ▼         ▼
  T4   T5        T6
 (edit (Drive   (vitest +
  /undo interplay) manual
  verify)          matrix)
        │
        ▼
T7 (update cue — optional, Open Q1)
```
T3 is the keystone. T4/T5/T6 can proceed in parallel once T3 lands.

---

## Phase 1 — Unblock

### T1 · Retarget the single-tab lock to a DB-upgrade failsafe
Remove proactive multi-tab blocking; keep the overlay only for genuine IDB
`onblocked`.
- Delete the `ping`/`pong`/`takeover` flow and the initial `postMessage('ping')`
  (`:3738–3759`). Remove the takeover button handler.
- Keep `tabChannel` (the `BroadcastChannel`) — repurposed as the change bus in T2.
- Keep `#single-tab-overlay` markup/styles, but it is now shown **only** by
  `onDbBlocked` (rare, real DB-version conflict). Update its i18n copy
  (`blocked.title/body`) to describe a transient DB-busy state, not "open in
  another tab"; drop/repurpose the "Use here" button (no takeover concept now).
- `_isBlocked` may stay as a guard for the DB case.

Acceptance:
- [ ] Opening a 2nd tab no longer shows any overlay; both load and render.
- [ ] `onDbBlocked` still reachable for a true IDB `onblocked`.
Verify:
- [ ] Open two tabs of `zenit-week.html` → both usable, no overlay.
- [ ] `npm run validate` passes (no dangling i18n keys / dead ids).
- [ ] Grep: no remaining `'ping'|'pong'|'takeover'` references.

**CHECKPOINT A** — two tabs coexist; app works solo and in two tabs (no sync yet);
DB-upgrade failsafe intact. Human review before T2.

---

## Phase 2 — Signal + converge

### T2 · Per-tab origin id and broadcast on save
- At startup assign `const TAB_ID = genId()`.
- In `saveWeek`, after the IDB write succeeds, broadcast
  `{ type:'week-saved', wk, sig: _weekContentSig(persisted), origin: TAB_ID }`
  over `tabChannel`.
- Ignore self-originated messages (`msg.origin === TAB_ID`).

Acceptance:
- [ ] Every committed change in tab A emits exactly one `week-saved` for that `wk`.
- [ ] A tab ignores its own broadcasts.
Verify:
- [ ] Two tabs, console-log received signals → A's edits show in B's log, not A's.

### T3 · Receive → merge the current week (loop-safe) — KEYSTONE
On `week-saved` from another origin:
- If `wk !== currentWeekKey` → no-op (IDB already holds peer write; nothing shown).
- If `wk === currentWeekKey`:
  1. If `msg.sig === _weekContentSig(weekData)` → no-op (already converged).
  2. `remoteData = await loadWeekIDB(wk)`.
  3. `merged = mergeWeekData(structuredClone(weekData), remoteData)`.
  4. `json = JSON.stringify(merged)`, `hash = fnv1a32(json)`,
     `scheduleUpload = hash !== fnv1a32(JSON.stringify(remoteData))`.
  5. `applyRemoteMerge(wk, merged, json, hash, scheduleUpload, remoteData)`
     — reuses atomic-op deferral + no-op-render guard.
- Loop suppression: the sig-equality guard (step 1) terminates any A→B→A echo;
  `applyRemoteMerge` only re-broadcasts (via T2's `saveWeek` path) when content
  actually changed.

Acceptance:
- [ ] Two tabs, **different** weeks: fully independent, no spurious re-renders.
- [ ] Two tabs, **same** week: disjoint edits union; no infinite re-broadcast.
- [ ] A remote record identical to local is a no-op (no render, no re-broadcast).
Verify:
- [ ] Manual: add nodes in each of two same-week tabs → both converge.
- [ ] Console: confirm signals quiesce (no ping-pong) after convergence.

**CHECKPOINT B** — live multi-tab merge works for the real workflow. Human review
before hardening.

---

## Phase 3 — Harden

### T4 · Mid-edit / undo safety (verify-and-reuse)
- Confirm a `week-saved` arriving during an active rename is deferred: rename path
  sets `beginAtomicOp()` (`:9108`) so `applyRemoteMerge` queues into
  `pendingRemoteMerge`, flushed by `endAtomicOp`. Add a test/log to prove it.
- Confirm structural mutations (`beginAtomicOp`…`endAtomicOp` windows) never take a
  merge mid-op.
- Undo/redo: **leave the local stack untouched** on merge (resolved decision) — the
  receive path pushes no undo snapshot and clears nothing.

Acceptance:
- [ ] Typing a rename in A while B saves → A's in-progress text is not lost.
- [ ] Undo in A after a merge replays A's own history; self-heals on next save if it
      revives a peer-deleted node.
Verify:
- [ ] Manual: rename-in-flight + peer save; undo-after-merge.

### T5 · Drive sync interplay
- Ensure a local merge that changed content sets `scheduleUpload` so the change
  still reaches Drive (mirrors `_commitRemoteMerge` `:5188–5191`).
- Local broadcast fires immediately; Drive stays 10s-debounced. No double-upload.

Acceptance:
- [ ] With Drive on, a two-tab convergence also propagates to Drive once.
Verify:
- [ ] Manual with a signed-in account: edit in A, observe B converge, then Drive
      shows the merged result.

### T6 · Tests (vitest, data logic)
Add cases (per spec §4):
- [ ] `mergeWeekData` disjoint edits → union, no loss.
- [ ] Same node conflict → higher `_ts` wins.
- [ ] Delete vs edit of same node → tombstone wins.
- [ ] Sig-equality no-op (identical record → no change).
- [ ] Deferral: merge requested while `isAtomicOpActive()` queues + flushes.
Verify: `npm test` green; `npm run validate` clean.

**CHECKPOINT C** — tests pass, Drive still syncs, full manual matrix passes.
Human review before optional polish.

---

## Phase 4 — Optional polish

### T7 · "Updated by another tab" cue (Open Q1)
- Decide silent re-render (default) vs subtle flash vs small toast. If a cue:
  reuse `showToast` for a one-line, non-blocking notice when the current week was
  changed by a peer.
Acceptance: [ ] Non-intrusive, no layout shift, dismissible/auto.

---

## Risks & mitigations
- **Echo storm** between tabs → sig-equality guard (T3.1) + change-only
  re-broadcast. Primary correctness risk; covered by T3 + T6 quiescence check.
- **Lost keystrokes on merge** → atomic-op deferral already exists (T4 verifies).
- **IDB `onblocked` deadlock** → only on version upgrade; `DB_VERSION` constant;
  failsafe overlay retained (T1).
- **Drive double-write** → reuse existing `scheduleUpload`/debounce (T5).

## Out of scope (per spec §3)
SharedWorker rewrite · leader/follower election · cross-device realtime beyond
Drive · any reintroduced blocking lock.

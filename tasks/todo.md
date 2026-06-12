# TODO — Multi-tab editing (Option B)

Plan: `tasks/plan.md` · Spec: `docs/specs/multi-tab-week-view.md`

## Phase 1 — Unblock
- [x] **T1** Retarget single-tab lock → DB-upgrade failsafe
  - [x] Remove `ping`/`pong`/`takeover` flow + initial ping
  - [x] Remove takeover button handler + button markup + dead CSS
  - [x] Keep `tabChannel`; keep `#single-tab-overlay` for `onDbBlocked` only
  - [x] Update `blocked.*` i18n copy → transient DB-busy, drop "Use here" (EN+CS)
  - [x] Verify: `npm run validate` clean; `npm test` 470/470; no ping/pong/takeover left
- [ ] **CHECKPOINT A** — human review (manual two-tab check)

## Phase 2 — Signal + converge
- [x] **T2** Per-tab origin id + broadcast on save
  - [x] `const TAB_ID = genId()` at startup
  - [x] `saveWeek` broadcasts `{type:'week-saved', wk, sig, origin}` post-IDB
  - [x] `tabChannel.onmessage` skeleton ignores self-originated messages (T3 fills body)
  - [x] Verify: `npm run validate` clean; `npm test` 470/470
- [x] **T3** Receive → merge current week (keystone)
  - [x] No-op when `wk !== currentWeekKey`
  - [x] Sig-equality early-out (no-op when converged; halts echo)
  - [x] `mergeWeekData` + `applyRemoteMerge` with correct `scheduleUpload`
  - [x] Re-broadcast at `_commitRemoteMerge` chokepoint (gated on `scheduleUpload`)
        so the *sender* side also reconverges — fixes a gap in the original plan
  - [x] Verify: `npm run validate` clean; `npm test` 470/470 (regression)
  - [ ] Manual (Checkpoint B): two-tab convergence + console quiescence
- [ ] **CHECKPOINT B** — human review (manual two-tab check)

## Phase 3 — Harden
- [x] **T4** Mid-edit / undo safety
  - [x] Audited all 4 `_editing` sites → all open input inside an atomic op
        (via `_openInlineInput`/`startAgendaRename` → `beginAtomicOp`)
  - [x] Made the invariant explicit: `applyRemoteMerge` also defers on
        `hasEditingNode()`, not only `isAtomicOpActive()` (future-proof)
  - [x] Confirmed merge path takes no undo snapshot → undo stack untouched
  - [x] Verify: `npm run validate` clean; `npm test` 470/470
  - [ ] Manual: rename-in-flight + peer save (no lost text); undo-after-merge
- [x] **T5** Drive interplay — verified by reuse, no code change needed
  - [x] Local merge with new content → `scheduleUpload` → `scheduleDriveSync` (5220)
  - [x] `scheduleDriveSync` is `googleAccessToken`-guarded + 10s-debounced;
        peer broadcast is immediate (synchronous postMessage)
  - [x] No double-upload: `syncWeekToDrive` pull-merge-push + hash dedup (5600)
        skips the 2nd tab's redundant upload — two tabs == two devices
  - [x] `npm test` 470/470 (no regression from T1–T4)
- [ ] **T6** vitest: union / `_ts` win / tombstone win / sig no-op / deferral; `npm test` green
- [ ] **CHECKPOINT C** — human review

## Phase 4 — Optional polish
- [ ] **T7** "Updated by another tab" cue (silent vs toast) — Open Q1

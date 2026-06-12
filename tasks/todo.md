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
- [ ] **T3** Receive → merge current week (keystone)
  - [ ] No-op when `wk !== currentWeekKey`
  - [ ] Sig-equality early-out (no-op when converged)
  - [ ] `mergeWeekData` + `applyRemoteMerge` with correct `scheduleUpload`
  - [ ] Verify: different weeks independent; same week converges; no echo storm
- [ ] **CHECKPOINT B** — human review

## Phase 3 — Harden
- [ ] **T4** Mid-edit / undo safety (verify-and-reuse atomic-op deferral)
  - [ ] Rename-in-flight + peer save → no lost text
  - [ ] Undo stack untouched on merge (resolved decision)
- [ ] **T5** Drive interplay — local-changed merge sets `scheduleUpload`; no double-upload
- [ ] **T6** vitest: union / `_ts` win / tombstone win / sig no-op / deferral; `npm test` green
- [ ] **CHECKPOINT C** — human review

## Phase 4 — Optional polish
- [ ] **T7** "Updated by another tab" cue (silent vs toast) — Open Q1

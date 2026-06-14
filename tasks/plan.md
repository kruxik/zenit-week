# Plan — Onboarding Part A: Seed Playground

Source spec: [`docs/specs/onboarding-part-a-playground.md`](../docs/specs/onboarding-part-a-playground.md)
Seed content: [`assets/playground-seed.json`](../assets/playground-seed.json)
Task list: `tasks/todo.md` · Single file: `zenit-week.html`

## Principles
- **Vertical slices.** Each task delivers one complete, testable path (loader→render, edit→flag-drop, action→cleanup, threshold→nudge) — not horizontal layers.
- **Single-file policy.** All app code lands in `zenit-week.html`. Only the build/inject script is separate.
- **Each slice ships with:** code + EN/CS i18n (where user-visible) + vitest coverage. `npm test` and `npm run validate` green before commit.

## Dependency graph
```
S1 Seed embedding + loader  ── foundational (creates _demo nodes on disk)
        │
        ├──> S2 _demo drop-on-touch   (needs _demo nodes to be meaningful)
        │            │
        │            └──> S3 Manual cleanup (Help)  (distinguishes touched vs untouched)
        │                          │
        └──────────────────────────┴──> S4 Auto-nudge banner  (counts user nodes; triggers S3)
```
Strict order: **S1 → S2 → S3 → S4.** No parallelism (each builds on the prior). i18n is added inside the slice that introduces the string.

## Key code anchors (verified)
- Boot init: `zenit-week.html:14548` (`window.addEventListener('load')`), seed hook after `runMigrationIfNeeded()` (`:14550`), before `loadAndRender(initialWeek)` (`:14598`).
- Empty-DB check: `listWeekKeysIDB()` `:4228`. Save week: `saveWeekIDB()` `:4207`. Misc flags: `saveValueIDB`/`loadValueIDB` `:4250`/`:4261`.
- New-week shape (`tombstones`/`crdtVersion`): `loadWeek()` `:7207`. `todayWeekKey()` `:6960`.
- Colors: `saveBranchColors` / `COLORS_STORAGE_KEY` (`zenit-week-colors` in misc); palette `BRANCH_COLOR_PALETTE` `:4553` (Growth green `#0ACF83`).
- Mutators for `_demo` drop: inline-input commit `_openInlineInput` `:9712`; move/drag drop handler; done/unplanned setters (D/U keys + ctx menu); priority setter; counter tick; add-child/add-node; (delete = N/A).
- Snapshot/undo chokepoint: `takeSnapshot()` `:4369` (node-agnostic — do NOT use for per-node drop).
- Confirm dialog: `showAppConfirm({title,body,okLabel,danger,onConfirm})`. Buttons: `.agenda-action-btn`.
- Help panel: `#help-panel` / `#help-content` (`:2831`). Build script: `scripts/inject-version.js`, npm `build`.

---

## S1 — Seed embedding + first-run loader  *(the spine; delivers the aha)*
**Goal:** Empty DB (or `#playground`) → current week boots fully populated from the seed, with Growth green.

Subtasks:
1. **Inject step.** New `scripts/inject-playground-seed.mjs` reads `assets/playground-seed.json` and writes it into a delimited constant block in `zenit-week.html` (e.g. between `/* PLAYGROUND_SEED_START */` … `/* PLAYGROUND_SEED_END */`). Wire into the `build` npm script (alongside `inject-version`). Pattern mirrors `scripts/inject-version.js`.
2. **Seed constant.** Add the placeholder block + `const PLAYGROUND_SEED = {…}` in `zenit-week.html`; run the inject step to populate it.
3. **`maybeSeedPlayground()`** in init flow (`:~14550`): trigger (empty DB ∨ `#playground`) + safety gate (current week absent in IDB) + idempotency flag `zenit-week-onboarded`.
4. Build week: `weekKey=todayWeekKey()`, stamp `_demo:true` + fresh `_ts` per node, `tombstones:[]`, `crdtVersion:0`; apply seed branch colors; `saveWeekIDB`; set flag; strip `#playground` via `history.replaceState`.

**Acceptance criteria**
- Fresh profile → first load shows full seeded mindmap; agenda + summary/balance populated, no user action.
- Reload → no re-seed, no duplicate nodes, URL has no `#playground`.
- Existing user with data for current week + `#playground` → not clobbered, no seed.
- Growth renders `#0ACF83`; work/family/me default colors.

**Verification**
- `tests/onboarding-seed.test.js` (fake-indexeddb): seeds on empty; no-op on populated; `#playground` gate; flag blocks re-seed; nodes carry `_demo` + correct weekKey.
- Manual: clear IndexedDB → open `zenit-week.html` → see populated week; reload → stable.
- `npm test` + `npm run validate` green.

**■ Checkpoint C1 (human):** open the app fresh, confirm the seeded week *feels* like an aha. Tune `playground-seed.json` content if needed before proceeding.

---

## S2 — `_demo` drop-on-touch
**Goal:** The moment the user makes a seed node theirs, it stops being demo scaffolding.

Subtasks:
1. `clearDemo(nodeId)` helper (`delete n._demo`; caller's existing `saveWeek` persists).
2. Call from each mutator (for the affected node): rename commit; move/drag drop; done toggle; unplanned toggle; priority change; counter tick; add-child/add-node (new node never gets `_demo`; also `clearDemo(parentId)`).
3. Confirm color/theme/zoom/pan are NOT treated as touches.

**Acceptance criteria**
- Each listed edit removes `_demo` from the affected node (and parent for add-child); persisted to IDB.
- Untouched nodes retain `_demo`.

**Verification**
- Extend test file: one unit case per mutator asserting flag dropped; one asserting untouched node keeps it.
- Manual: rename a demo node, reload → flag gone (verify via cleanup leaving it).
- `npm test` green.

---

## S3 — Manual cleanup ("Clear example tasks")
**Goal:** One action removes only untouched demo nodes; branches and user work survive; undoable.

Subtasks:
1. Cleanup fn: `takeSnapshot()` → tombstone + remove nodes where `_demo===true` (skip branches) → `rebuildNodeMap` → `saveWeek` → `render`.
2. Permanent entry in Help panel (`.agenda-action-btn`), routed through `showAppConfirm({danger:true})`.
3. i18n: `onboarding.clearExample`, `clearConfirmTitle`, `clearConfirmBody`, `clearConfirmOk` (EN + CS).

**Acceptance criteria**
- Removes exactly the `_demo` activity/counter nodes; all 4 branches remain even if emptied; user-touched/created nodes remain.
- Undoable (Ctrl/⌘+Z restores removed nodes).
- No native dialogs; EN/CS present.

**Verification**
- Test: seed → touch 2 nodes → cleanup → only untouched demo gone, branches intact, snapshot restores.
- Manual: run from Help, confirm dialog, verify result + undo.
- `npm test` + `npm run validate` green.

**■ Checkpoint C2 (human):** verify full play→cleanup→undo loop in browser.

---

## S4 — Gentle auto-nudge banner
**Goal:** Once the user has clearly started their own week, gently offer cleanup — once.

Subtasks:
1. Threshold logic: real user nodes (non-`_demo`, minus original branch count) ≥ 3 **and** ≥1 `_demo` node remains.
2. Non-blocking dismissible banner/toast: message + **Clear** (runs S3) + **Dismiss**.
3. Once-only: `zenit-week-playground-nudged` flag in misc; never re-show after dismiss/action.
4. i18n: `onboarding.nudge`, `onboarding.nudgeDismiss` (EN + CS).

**Acceptance criteria**
- Fires once when threshold met with demo remaining; never reappears after dismiss/action.
- Clear button runs cleanup (S3); dismiss sets flag.

**Verification**
- Test: threshold gate (2 user nodes → no nudge; 3 + demo → nudge; flag set → no nudge).
- Manual: seed → add 3 nodes → banner appears → dismiss → reload → no banner.
- `npm test` + `npm run validate` green.

**■ Checkpoint C3 (human, final):** end-to-end first-run journey on a clean profile; sign-off to ship Part A.

---

## Out of scope (later builds)
- Part B progressive coachmarks.
- Settings-based playground re-entry / tuning.
- Landing-page changes.

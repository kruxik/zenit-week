# TODO — Quiet Refresh

Companion to `tasks/plan.md`. Check off as you go. Each `[ ]` is small enough to complete and verify in one sitting.

## Slice 1 — Tag-driven versioning + Help footer display

- [ ] 1.1 Create `scripts/inject-version.js` (ES module): resolve version → validate regex → replace `__APP_VERSION__` in `zenit-week.html` → assert exactly one occurrence → write back.
- [ ] 1.2 Add `"build": "node scripts/inject-version.js"` to `package.json` scripts.
- [ ] 1.3 Update `vercel.json`: add `buildCommand: "npm run build"`; add `headers` block setting `Cache-Control: public, max-age=0, must-revalidate` for `/zenit-week.html` and `/app(.*)`.
- [ ] 1.4 Insert literal `__APP_VERSION__` placeholder into `zenit-week.html` exactly once (suggest: a hidden `<span id="app-version">__APP_VERSION__</span>` inside `#help-content` footer, or a `<meta name="version">`).
- [ ] 1.5 Render version into Help panel footer via `textContent` (read from the placeholder element or `meta`). Style: muted, footer position.
- [ ] 1.6 Write `tests/inject-version.test.js`: covers valid CalVer, valid same-day-suffix, SHA fallback, `dev` fallback, malformed-tag rejection, zero-occurrence error, multi-occurrence error.
- [ ] 1.7 Run `npm test -- inject-version` → green.
- [ ] 1.8 Run `npm run validate` → green.
- [ ] 1.9 Test build locally: `npm run build` then grep for `__APP_VERSION__` in `zenit-week.html` — should be zero matches; revert the file before committing (or write to a temp output — decide in 1.1).
- [ ] 1.10 Commit slice. Push.
- [ ] 1.11 Tag `v2026.05.11` (or appropriate CalVer for the day) and push tags. Watch Vercel deploy.
- [ ] **CHECKPOINT 1**: open `/app` in browser, open Help panel, confirm version string visible. Run `curl -I` on `/app` — confirm `Cache-Control` and ETag headers.

## Slice 2 — ETag probe (observability-only)

- [ ] 2.1 Add module-level state in `zenit-week.html`: `let _pendingReload = false; let _newAssetEtag = null;`
- [ ] 2.2 Implement pure helper `parseAssetVersionHeaders(headers)` returning `{ etag, lastModified, token }`.
- [ ] 2.3 Implement `checkForAssetUpdate({ seedOnly = false } = {})`: HEAD `/app?v=<ts>` with `cache: 'no-store'`, parse headers, compare to `localStorage['zenit-week-asset-etag']`. On change: log `[quiet-refresh] update-detected`, set `_pendingReload = true`, set `_newAssetEtag`, immediately write new value to localStorage (loop guard).
- [ ] 2.4 Wire into existing `visibilitychange` handlers at `:3949` and `:10557` (call when `visibilityState === 'visible'`).
- [ ] 2.5 Add `window.addEventListener('focus', () => checkForAssetUpdate())`.
- [ ] 2.6 Call `checkForAssetUpdate({ seedOnly: true })` once during init — seeds baseline ETag without flagging pending.
- [ ] 2.7 Wrap fetch in try/catch; swallow network errors with `console.debug('[quiet-refresh] probe-failed', err.message)`.
- [ ] 2.8 Write `tests/quiet-refresh-headers.test.js`: ETag-over-LastModified precedence; missing headers; weak ETag preserved as-is; null inputs.
- [ ] 2.9 Run `npm test` → all green.
- [ ] 2.10 Deploy. Tag next CalVer.
- [ ] **CHECKPOINT 2**: with DevTools open, switch tab away & back after a deploy → see `update-detected` in console; `_pendingReload === true` in console; localStorage shows the new ETag already. No reload occurred.

## Slice 3 — Restore payload round-trip (manual trigger)

- [ ] 3.1 Implement `buildRestorePayload(state)` → `{ v: 1, ts: Date.now(), panX, panY, zoom, currentView, currentWeekKey, hoveredNodeId }`.
- [ ] 3.2 Implement `applyRestorePayload(payload, ctx)`: validate `v === 1`; reject if `Date.now() - ts > 5*60*1000`; reject if `payload.currentWeekKey !== ctx.currentWeekKey`; apply pan/zoom/view; set `hoveredNodeId` only if `findNode(id)` returns truthy.
- [ ] 3.3 Add restore-on-load hook in init: read `localStorage['zenit-week-pending-restore']`, JSON.parse safely (try/catch → clear+ignore), call `applyRestorePayload`, clear the key.
- [ ] 3.4 Expose debug helper: `window.__quietRefreshReloadNow = function() { localStorage.setItem('zenit-week-pending-restore', JSON.stringify(buildRestorePayload(currentState()))); location.reload(); };` (add code comment: "Manual test surface for quiet-refresh restore round-trip — keep in production for diagnosability.")
- [ ] 3.5 Write `tests/quiet-refresh-restore.test.js`: round-trip identity, schema-version mismatch, staleness, week mismatch, missing-node-id graceful.
- [ ] 3.6 Run `npm test` → green.
- [ ] 3.7 Manual: pan to off-center, zoom to non-default, hover a node, run `__quietRefreshReloadNow()` in console. Expect viewport identical post-reload.
- [ ] 3.8 Manual: switch to a different week, run `__quietRefreshReloadNow()`. Expect viewport restored but `currentWeekKey` mismatch causes payload to be discarded (whatever week the app boots into is fine — guard fires).
- [ ] **CHECKPOINT 3**: lossless restore confirmed in console-trigger mode.

## Slice 4 — Quiescence gate + auto-reload

- [ ] 4.1 Implement pure `isAppQuiescent(state)` accepting `{ hasEditingNode, isPanning, atomicOpsDepth, pendingUploadKey, openPanels: string[] }`. Returns `true` only when every input is falsy/empty.
- [ ] 4.2 Implement DOM-aware `_collectQuiescenceState()`: scans `weekData.nodes` for `_editing`, reads `isPanning`, `_atomicOpsDepth`, `_pendingUploadKey`, builds `openPanels` array by checking `.visible` class on the tracked panel IDs (list in spec/plan).
- [ ] 4.3 Implement `tryQuietReload()`: if `!_pendingReload` return; collect state; if not quiescent, `console.debug('[quiet-refresh] reload-deferred', { reason })` (reason = first failing predicate name) and return; else build payload, write localStorage, `console.debug('[quiet-refresh] reload-fired')`, `location.reload()`.
- [ ] 4.4 Wire `tryQuietReload()` at all transition points (call after the state mutation that might restore quiescence):
  - [ ] 4.4a End of edit commit / `delete node._editing`
  - [ ] 4.4b `isPanning = false` site (pan-end, `~:9948`, `:10226`, `:10263`)
  - [ ] 4.4c Every `panel.classList.remove('visible')` site (or a helper that wraps panel-close)
  - [ ] 4.4d `_flushPendingSync()` after `_atomicOpsDepth === 0` settles
  - [ ] 4.4e Drive upload completion
  - [ ] 4.4f `#app-confirm-overlay` close
- [ ] 4.5 Verify `beforeunload` handler does **not** call `tryQuietReload()` — read-only check only.
- [ ] 4.6 Write `tests/quiet-refresh-quiescence.test.js`: per-input matrix; all-clear; reason-reporting.
- [ ] 4.7 Run full `npm test` → green.
- [ ] 4.8 Manual desktop matrix (spec §5):
  - [ ] Happy path
  - [ ] Mid-edit defer
  - [ ] Panel-open defer (settings / help / context-menu / color-picker / baseline / app-confirm — one at a time)
  - [ ] In-flight Drive defer
- [ ] **CHECKPOINT 4**: desktop matrix passes; silent reload works end-to-end.

## Slice 5 — Hardening + final matrix

- [ ] 5.1 Loop-guard test: intentionally break the next deploy (e.g., temp commit with a syntax error in HTML), confirm app reloads once and not again. Revert.
- [ ] 5.2 iOS standalone test: install `/app` to home screen on a real iPhone, deploy a visible change, foreground app, verify silent reload + viewport intact.
- [ ] 5.3 Cache-buster choice: pick `?v=<timestamp>` or `?v=<last-known-etag>` based on Network tab observation; document the choice in a code comment; remove the other.
- [ ] 5.4 Lang/theme restoration: check for FOUC during reload on iOS Safari standalone (slowest paint path). If visible flash, add `currentLang`/`theme` to restore payload; if not, leave alone and add a code comment explaining the decision.
- [ ] 5.5 Add a one-line comment near `__quietRefreshReloadNow` confirming intentional retention.
- [ ] 5.6 If Help footer uses a localized prefix ("Version: " / "Verze: "), add `TRANSLATIONS.en['help.version']` and `cs` equivalents. If pure version string, skip.
- [ ] 5.7 Update `CHANGELOG.md`.
- [ ] 5.8 Walk spec §9 acceptance checklist top to bottom; tick each box.
- [ ] **CHECKPOINT 5**: all green, ready to merge / cut release tag.

## Definition of Done

- All checkboxes above ticked.
- Spec §9 acceptance checklist ticked.
- Manual matrix (spec §5) recorded in PR description.
- No new ESLint/html-validate warnings introduced.
- Total `zenit-week.html` additions ≤ ~120 LOC; `scripts/inject-version.js` ≤ 30 LOC.

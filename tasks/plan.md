# PLAN — Quiet Refresh

**Source:** `docs/specs/quiet-refresh.md` · **Branch:** `main` · **Owner:** kruxik

## Approach

Five vertical slices, each independently shippable and observable. Each slice ends with a working, verifiable behavior — no slice leaves dead code waiting for a later slice. Loop-guard, restore correctness, and reload-deferral are proven *before* auto-reload is enabled.

## Dependency Graph

```
Slice 1: Versioning pipeline ─────────────┐
   (vercel.json + scripts/inject-version + Help footer)
                                          │
                                          ▼
Slice 2: ETag probe (log-only) ───────► detects updates, no reload
   (checkForAssetUpdate + lifecycle wiring + console.debug)
                                          │
                                          ▼
Slice 3: Restore round-trip ──────────► proves state survives reload
   (buildRestorePayload + applyRestorePayload + early-init apply
    + window.__quietRefreshReloadNow debug trigger)
                                          │
                                          ▼
Slice 4: Quiescence gate + auto-reload ► full silent refresh path
   (isAppQuiescent + tryQuietReload + transition-handler wiring)
                                          │
                                          ▼
Slice 5: Hardening + manual matrix ───► production-ready
   (loop guard verification, staleness, edge cases, iOS standalone test)
```

Slices 1 and 2 are independently shippable and useful in isolation. Slices 3–5 build the silent-reload mechanism; 5 is gating before declaring done.

## Vertical Slices

### Slice 1 — Tag-driven versioning + Help footer display

**Goal:** Pushing a CalVer tag deploys a build whose version is visible in the Help panel footer. ETag of `/app` changes byte-for-byte on each tagged deploy.

**Files touched:**
- `scripts/inject-version.js` (new, ≤30 LOC, ES module to match repo style)
- `package.json` — add `"build": "node scripts/inject-version.js"` to scripts
- `vercel.json` — add `buildCommand: "npm run build"` and `headers` block for Cache-Control on `/zenit-week.html` and `/app(.*)`
- `zenit-week.html` — embed literal `__APP_VERSION__` once (in a `<meta>` tag or a hidden `<span>`); render into Help footer via `textContent`
- `tests/inject-version.test.js` (new)

**Acceptance criteria:**
- Running `npm run build` locally on a tagged commit replaces `__APP_VERSION__` with the tag (e.g., `v2026.05.11`); idempotent: a second run after re-checkout reproduces same result.
- Regex `/^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/` accepts `v2026.05.10` and `v2026.05.10.1`; rejects `v2026.5.10`, `2026.05.10`, `v2026.05.10-rc1`.
- Fallback chain: missing tag → `dev-<sha7>` from `VERCEL_GIT_COMMIT_SHA` → `dev`. Both fallbacks are valid; script exits 0.
- Zero or >1 placeholder occurrences in HTML → script exits non-zero with clear message.
- Help footer shows the version string rendered via `textContent` (never `innerHTML`).
- `curl -I https://<deploy>/app` returns `Cache-Control: public, max-age=0, must-revalidate` and a stable `ETag`.

**Verification:**
- `npm test -- inject-version` passes.
- Manual: `git tag v2026.05.11 && git push --tags`, wait for Vercel deploy, open `/app`, open Help panel, see `v2026.05.11` in footer.
- Manual: `curl -I` shows expected headers.

---

### Slice 2 — ETag probe in observability-only mode

**Goal:** On `visibilitychange`/`focus`/initial-load, the app probes its own asset URL with a cache-busting HEAD, compares the ETag to `localStorage['zenit-week-asset-etag']`, and `console.debug`s on change. Does **not** reload. Stores the new ETag immediately on detection (loop-guard semantics in place from day one).

**Files touched:**
- `zenit-week.html`:
  - Add `checkForAssetUpdate()` near existing Drive ETag block (~line 4400).
  - Add module-level state: `let _pendingReload = false; let _newAssetEtag = null;`
  - Extend `visibilitychange` handlers at `:3949` and `:10557` to call `checkForAssetUpdate()` when `document.visibilityState === 'visible'`.
  - Add `focus` listener.
  - Call `checkForAssetUpdate({ seedOnly: true })` once on initial load — seeds baseline ETag without setting `_pendingReload`.
- `tests/quiet-refresh-headers.test.js` (new) — unit tests for `parseAssetVersionHeaders(headers)`.

**Pure helper (testable):**
```js
function parseAssetVersionHeaders(headers) {
  // headers: { get(name): string|null }
  // Returns: { etag, lastModified, token } where token = etag || lastModified || null
}
```

**Acceptance criteria:**
- HEAD request hits `/app?v=<timestamp>` with `cache: 'no-store'`. (Use `/app`, not `/zenit-week.html`, to match user-facing URL and avoid two parallel cache lifetimes.)
- ETag is preferred over Last-Modified; weak ETags (`W/"..."`) are compared as-is.
- On first-ever load, baseline ETag is seeded into `localStorage`; `_pendingReload` stays false.
- On detected change: `_pendingReload = true`, `_newAssetEtag` cached in memory, **and** `localStorage['zenit-week-asset-etag']` is updated to the new value immediately (loop guard).
- `console.debug('[quiet-refresh] update-detected', { etag, prevEtag })` fires.
- No reload occurs in this slice.
- Network failures (offline, 5xx) are swallowed silently and logged at `console.debug` level only.

**Verification:**
- `npm test -- quiet-refresh-headers` passes.
- Manual: open DevTools console, deploy a change, switch tab away and back, see `update-detected` debug line.
- Manual: with no network, foregrounding the app produces no errors and no false update detection.

---

### Slice 3 — Restore payload round-trip (manual trigger)

**Goal:** Volatile view-state survives a `location.reload()` losslessly. Verified by an explicit debug trigger; not yet auto-fired.

**Files touched:**
- `zenit-week.html`:
  - Add pure helpers:
    - `buildRestorePayload(state)` → `{ v: 1, ts, panX, panY, zoom, currentView, currentWeekKey, hoveredNodeId }`
    - `applyRestorePayload(payload, ctx)` — validates `v === 1`, `ts` within 5 min, `currentWeekKey` matches; applies pan/zoom/view; sets `hoveredNodeId` (if node still exists).
  - Restore-on-load hook: early in init (after `currentWeekKey` resolved, before first `render()`), read `zenit-week-pending-restore`, apply, clear key.
  - Debug helper: `window.__quietRefreshReloadNow = function() { /* persist + reload */ }` — gated behind no flag, just exposed for manual testing. Documented but not removed (per spec §8 open question — keep as debug surface).
- `tests/quiet-refresh-restore.test.js` (new) — property tests + edge cases.

**Acceptance criteria:**
- Round-trip identity: any `state` → `buildRestorePayload` → JSON → parse → `applyRestorePayload` reproduces pan/zoom within `< 0.001` epsilon, all other fields exact.
- Schema version mismatch (`v !== 1`) → payload discarded, key cleared, no exception thrown.
- Staleness: `Date.now() - ts > 5*60*1000` → discarded silently.
- Week mismatch: `payload.currentWeekKey !== currentWeekKey` → discarded (user changed week manually before reload).
- Missing `hoveredNodeId` target (node deleted in another tab/Drive sync) → ignored gracefully; pan/zoom/view still applied.
- `__quietRefreshReloadNow()` from DevTools triggers a real reload; after reload the viewport is visually identical.

**Verification:**
- `npm test -- quiet-refresh-restore` passes.
- Manual: open app, pan + zoom to off-default location, hover a node, run `__quietRefreshReloadNow()` in console, observe reload, observe viewport restored.
- Manual: pan + zoom, change to a non-current week, run `__quietRefreshReloadNow()` — viewport restores but week key restoration is gated (verifies week-mismatch guard behavior — should NOT restore stale week).

---

### Slice 4 — Quiescence gate + auto-reload

**Goal:** Connect slices 2 + 3. On detected update, the app autonomously reloads at the next quiescent moment, silently.

**Files touched:**
- `zenit-week.html`:
  - Pure helper: `isAppQuiescent(state)` — accepts an explicit state object; tested standalone.
  - DOM-aware wrapper `_collectQuiescenceState()` that reads:
    - any node has `_editing: true` (scan `weekData.nodes`)
    - `isPanning`
    - `_atomicOpsDepth > 0` OR `_pendingUploadKey != null` (Drive dirty)
    - `.visible` on: `#context-menu`, `#help-panel`, `#help`, `#color-picker-panel`, `#baseline-panel`, `#app-confirm-overlay`, `#settings-panel`, and any other panel with `.visible` toggled
    - any in-flight `fetch` for Drive (re-use existing pending-request counter if available, else add one)
  - `tryQuietReload()` — gated by `_pendingReload && isAppQuiescent(...)`; persists restore payload, calls `location.reload()`.
  - Wire `tryQuietReload()` at these transition points:
    - End of edit commit (`stopEditing` / `delete node._editing`)
    - `mouseup`/`touchend` that sets `isPanning = false`
    - Each `classList.remove('visible')` for tracked panels — wrap in a helper if cleaner
    - `_flushPendingSync()` completion (`_atomicOpsDepth === 0` transition)
    - Drive upload completion (resolve of the pending upload promise)
    - `app-confirm-overlay` close
  - Telemetry: `console.debug('[quiet-refresh] reload-deferred', { reason })` when `_pendingReload` is true but `isAppQuiescent` returns false (include reason — first failing predicate). `console.debug('[quiet-refresh] reload-fired')` immediately before `location.reload()`.
- `tests/quiet-refresh-quiescence.test.js` (new).

**Acceptance criteria:**
- `isAppQuiescent({...})` unit-tested for every individual "in" state (all false) and every "out" state (one true at a time) and the all-clear path.
- After update detection, foregrounding the app while editing → no reload, `reload-deferred` log fires with `reason: 'editing'`.
- Same for: panning, open panel (each), atomic op in flight, pending Drive upload.
- Closing the last blocker → reload fires immediately (within the next tick) without any user action other than dismissing the blocker.
- No reload from within `beforeunload`.

**Verification:**
- `npm test -- quiet-refresh-quiescence` passes.
- Manual: full matrix from spec §5 on desktop Chrome.

---

### Slice 5 — Hardening, edge cases, manual matrix

**Goal:** Production-ready. Loop guard validated; iOS standalone smoke-tested; deferred questions resolved.

**Tasks:**
- **Loop guard end-to-end:** deploy an intentionally broken HTML (e.g., a syntax error). Confirm app reloads exactly once; on subsequent foregroundings the new ETag is already cached and no further reloads fire.
- **iOS standalone test:** install to home screen on a real iPhone, deploy a visible change, foreground the app, observe the reload, confirm viewport intact.
- **Cache-buster choice:** decide between `?v=<timestamp>` and `?v=<last-known-etag>` based on CDN behavior observed in DevTools Network. Pick one, document in code comment, remove the other.
- **Lang/theme in payload — verify-or-not:** measure for FOUC on reload. If `currentLang`/`theme` restore from their own keys before first paint, skip. If a flash is visible, add to payload.
- **Debug helper retention:** confirm `window.__quietRefreshReloadNow` stays in shipped code (per spec §8); add a one-line code comment noting it.
- **Translations:** if Help footer shows a localized "Version: " prefix, add `en` and `cs` strings to `TRANSLATIONS` and `t()` keys. If the format is just `v2026.05.11`, no translation needed.

**Acceptance criteria:**
- All checkboxes in spec §9 are ticked.
- Reload-loop test passes.
- iOS standalone test passes.

**Verification:**
- Manual matrix complete; results recorded in PR description.

## Checkpoints (Human Review Gates)

- **After Slice 1** — confirm versioning pipeline works on a real tag push before adding any runtime logic. Get one tagged deploy out the door first.
- **After Slice 2** — confirm `update-detected` logs fire reliably across desktop + iOS before building the reload mechanism.
- **After Slice 3** — confirm restore is lossless via manual trigger before connecting it to auto-reload.
- **After Slice 4** — confirm quiescence-deferral matrix on desktop before shipping. iOS validation happens in Slice 5.
- **After Slice 5** — final spec §9 checklist sign-off.

## Risks / Watch-outs

- **Vercel git depth.** Default checkout is shallow; `git describe --tags` may fail. Mitigation: `git fetch --tags --depth=1` in build script; fallback chain tested.
- **iOS standalone caching.** Even with `Cache-Control: must-revalidate`, iOS may serve stale once. Quiet refresh covers this by re-checking on every foreground.
- **Hidden quiescence states.** A panel added later (new dialog, new drag mode) that isn't added to `isAppQuiescent` could cause reload mid-task. Mitigation: code comment near `isAppQuiescent` listing every checked state; add a CI grep test that scans for `.visible` toggles not present in the predicate? (Probably overkill — note in CONTRIBUTING.md.)
- **Drive race.** A reload mid-Drive-pull could overwrite local changes. The quiescence gate covers in-flight uploads; verify it also covers pulls (`startDrivePoll`).
- **`__APP_VERSION__` accidentally committed.** A developer might run `npm run build` locally and commit the resolved version. Mitigation: `npm run build` writes a `.gitignore`'d marker, or simply rely on the placeholder-count assertion to flag a re-build attempt. Document in CONTRIBUTING.md.

## Out of Scope (per spec)

Service worker, manifest.json, banners/toasts, periodic timer poll, `/version.json` sidecar, build-time stamping outside the placeholder mechanism.

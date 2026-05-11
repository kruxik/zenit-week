# SPEC — Quiet Refresh (Silent Auto-Update)

**Status:** Draft · **Owner:** kruxik · **Source idea:** `docs/ideas/quiet-refresh.md`

## 1. Objective

Ensure users on installed/home-screen webclips (especially iOS Safari standalone) reliably run the latest deployed version of `zenit-week.html` without ever seeing a banner, a reload prompt, or a flash of stale UI.

The mechanism must be **silent** (no UI), **non-disruptive** (never reloads mid-task), and **state-preserving** (post-reload the app looks pixel-identical to pre-reload).

**Target users:** existing Zenit Week users — primarily the project owner — who treat the app as an installed PWA-style home-screen icon and rarely cold-start the browser.

**Success criteria:**
- A deploy to Vercel becomes the active version on the user's device by the next time they bring the app to the foreground while idle.
- No reload ever fires while the user is editing a node, panning, has a menu/dialog open, or has an in-flight Drive write.
- After a quiet reload, viewport (pan/zoom), current view, current week, and hovered node are restored such that the user cannot perceive that a reload occurred.
- No reload loop: a broken deploy reloads at most once per device.

## 2. Commands

Local workflow unchanged — single file, open in browser. A **Vercel-side build step** is added solely to inject the git-tag version into the HTML at deploy time. No local build, no service worker, no manifest.

| Command | Purpose |
|---------|---------|
| open `zenit-week.html` in browser | run locally — placeholder `__APP_VERSION__` shows literally; that's fine |
| `npm test` | vitest unit suite (extend for quiescence-predicate + restore-payload + version-injection logic) |
| `npm run validate` | html-validate |
| `npm run build` (new) | invokes `node scripts/inject-version.js`; idempotent; replaces `__APP_VERSION__` in `zenit-week.html` with `git describe --tags --abbrev=0`. Used by Vercel; never committed locally. |
| `git tag v2026.05.11 && git push --tags origin main` (or `v2026.05.11.1` for an additional same-day deploy) | publishes a new release — Vercel build runs, injects the tag, deploys; ETag changes → quiet refresh fires on next user foreground. |

No new CLI commands beyond `npm run build`. No service worker registration step. No manifest changes.

## 3. Project Structure

Single-file runtime policy holds. All app logic stays in `zenit-week.html`. Build glue lives outside the asset so the source-as-shipped property is preserved:

```
zenit-week.html              # all runtime logic; contains literal placeholder `__APP_VERSION__`
vercel.json                  # Cache-Control header + buildCommand wiring
package.json                 # `build` script
scripts/inject-version.js    # tiny Node script: read git tag, replace placeholder
docs/specs/quiet-refresh.md  # this spec
```

`scripts/inject-version.js` responsibilities (deterministic, ≤30 LOC):
1. Resolve version: `git describe --tags --abbrev=0 2>/dev/null` → fallback to `VERCEL_GIT_COMMIT_SHA.slice(0,7)` prefixed with `dev-` → fallback to literal `dev`.
2. Validate format: matches `/^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/` (CalVer + optional same-day build counter, e.g. `v2026.05.10.1`) or starts with `dev`.
3. Read `zenit-week.html`, assert exactly one occurrence of `__APP_VERSION__`, replace in place, write back.
4. Exit non-zero on any mismatch (so a broken deploy fails loud rather than shipping a literal `__APP_VERSION__` to users).

Vercel git checkout is shallow by default; the build script runs `git fetch --tags --depth=1 2>/dev/null || true` before `git describe` to ensure tags are available. If both `git describe` and `VERCEL_GIT_*` env vars fail, the script falls through to `dev` (not a hard failure — the deployed asset is still self-consistent).

New logical modules inside `zenit-week.html` (no file split):

- **Asset version probe** — `checkForAssetUpdate()` issues conditional `HEAD` against the current document URL with a cache-buster, compares `ETag` (fallback `Last-Modified`) against `localStorage['zenit-week-asset-etag']`.
- **Quiescence predicate** — `isAppQuiescent()` enumerates all "user mid-task" states. Single source of truth.
- **Quiet-reload trigger** — `tryQuietReload()` invoked at every transition that *might* leave the app quiescent (edit-stop, pan-end, panel-close, sync-flush, atomic-op exit).
- **Restore payload** — write `zenit-week-pending-restore` before `location.reload()`; read & apply early on load.

`localStorage` keys added:
- `zenit-week-asset-etag` — last-known asset version token (ETag or Last-Modified).
- `zenit-week-pending-restore` — JSON-stringified view snapshot, consumed once on load.

## 4. Code Style

Follows the existing project conventions (see `CLAUDE.md`):

- `'use strict';` already enabled; `const`/`let` only; camelCase.
- **No `innerHTML`** with user-controlled strings. This feature touches no DOM strings, so the rule is trivially satisfied — but if any debug surface ever exposes the ETag, use `textContent`.
- DOM additions: none. Pure logic + lifecycle hooks.
- **No new dependencies, no new files, no build step.**
- Code lives near related lifecycle code. Probable insertion zones:
  - `checkForAssetUpdate()` + helpers: near the existing Drive ETag/`If-None-Match` block around `zenit-week.html:4400–4430`.
  - Wire-up: extend the existing `visibilitychange` handlers at `zenit-week.html:3949` and `zenit-week.html:10557` and the `focus` listener; add `tryQuietReload()` to `beforeunload`-adjacent code at `:10573` (read-only check there — don't reload from `beforeunload` itself).
  - Restore-on-load: early init, before first `render()`, after `currentWeekKey` and theme are resolved but before any user-perceivable paint.

**Logging:** `console.debug('[quiet-refresh] update-detected', { etag, prevEtag })`, `console.debug('[quiet-refresh] reload-deferred', { reason })`, `console.debug('[quiet-refresh] reload-fired')`. No user-facing UI, no toasts.

**Naming convention:** all new identifiers prefixed with `quietRefresh` or scoped inside an IIFE / module-style block to keep the global surface area visible.

## 5. Testing Strategy

### Unit (vitest)
Extract pure logic into testable units:
- `parseAssetVersionHeaders(headers)` → returns `{ etag, lastModified, token }`. Test header precedence (ETag wins), missing headers, weak ETags.
- `isAppQuiescent(state)` — pass an explicit state object so it can be unit-tested without a DOM. Cover every "in" combination and every "out" combination.
- `buildRestorePayload(state)` / `applyRestorePayload(payload, ctx)` round-trip. Property-test: random pan/zoom/view/week → serialize → parse → assert identity within float epsilon.
- Reload-loop guard: simulate "ETag changes, restore payload present" twice in a row — must not reload the second time without a fresh ETag delta.
- `scripts/inject-version.js`: unit-test the version-resolution + placeholder-replacement helper. Cover (a) valid CalVer tag `v2026.05.10`, (b) valid same-day-suffix tag `v2026.05.10.1`, (c) missing tag → SHA fallback, (d) missing tag and missing SHA → `dev` fallback, (e) malformed tag (e.g. `v2026.5.10`, `2026.05.10`) → rejected, (f) zero placeholder occurrences → throws, (g) two placeholder occurrences → throws.

### Manual / Browser
Required because the actual reload mechanic and iOS standalone behavior can't be unit-tested:
- **Happy path (desktop):** open app, deploy a visibly-different version, switch tab away & back → expect silent reload, viewport preserved.
- **Mid-edit defer:** open app, start editing a node, deploy, switch away & back while still editing → no reload. Commit edit → reload fires.
- **Panel-open defer:** open settings panel, deploy, switch away & back → no reload. Close panel → reload fires.
- **In-flight Drive defer:** trigger an atomic op that defers Drive upload (`_pendingUploadKey != null` or `_atomicOpsDepth > 0`), deploy, return → no reload until the upload completes (`startDrivePoll` settles, `_pendingUploadKey === null`).
- **iOS standalone:** install to home screen, deploy a visible change, foreground → reload fires; viewport intact.
- **Reload-loop:** corrupt the deploy (intentional syntax error in HTML) → app reloads once, fails to parse, but on next foreground does **not** reload again because the new ETag is already cached.
- **Lossless restore matrix:** for each combination of `currentView ∈ {mindmap, agenda}`, hovered node set/unset, non-default `panX/panY/zoom`, and `currentWeekKey` ≠ "this week" — verify reload preserves all four.

### Non-goals for testing
- No Playwright / browser-automation setup (would violate single-file ethos for marginal gain on a hobby project).
- No load testing; the HEAD request is one tiny call per foreground event.

## 6. Boundaries

### Always do
- Persist the **new** ETag to `localStorage` **before** calling `location.reload()`. Prevents reload loops on a broken deploy.
- Treat the quiescence predicate as the single source of truth. Any new "user mid-task" state added later (new panel, new drag operation) **must** be added to `isAppQuiescent()` in the same change.
- Cache-bust the HEAD request (`?v=<timestamp>` or `?v=<last-known-etag>`) and pass `cache: 'no-store'`. The request must hit the CDN.
- Fire the asset check on `visibilitychange` (when becoming visible), `focus`, and once on initial load (seed-only — first load never reloads).
- Set `Cache-Control: public, max-age=0, must-revalidate` for `/zenit-week.html` and `/app(.*)` in `vercel.json` as a belt-and-braces defense outside the in-app check.
- Restore payload schema: `{ v: 1, panX, panY, zoom, currentView, currentWeekKey, hoveredNodeId, ts }`. Reject mismatched `v` and clear the key.
- Discard a restore payload older than ~5 min (`Date.now() - ts > 5*60*1000`) — stale recoveries are worse than a clean load.

### Ask first
- Adding a user-facing surface (debug toggle in settings, status indicator in toolbar). The agreed design is **silent**.
- Adding a periodic timer poll. Visibility/focus is currently considered sufficient.
- Promoting this to a real service-worker PWA. Explicitly out-of-scope and rejected.

### Never do
- **Never** use `innerHTML` with anything sourced from the asset response, the restore payload, `localStorage`, or the injected version string. Render the version via `textContent`.
- **Never** reload while `isAppQuiescent()` returns false. No exceptions, no "with confirmation" fallback — the next foreground will catch the update.
- **Never** introduce a service worker, a `sw.js`, or manifest-based update lifecycle. Out of scope and rejects the project's Single File Policy.
- **Never** show a banner, toast, or modal about updates. Silent is the contract.
- **Never** rely on the version string as the freshness signal. **ETag is the sole freshness source of truth**; the version string is display-only.
- **Never** poll `/version.txt`, `/version.json`, or any sidecar file. The HTML's ETag *is* the version comparator.
- **Never** edit `__APP_VERSION__` manually or commit a resolved version into `zenit-week.html`. Versioning is tag-driven; the placeholder must remain in committed source.
- **Never** reload from within `beforeunload`. Read-only inspection there only.
- **Never** restore a payload across a different `currentWeekKey` than the one in the payload (avoid the user's manual week change being reverted by a stale restore).

## 7. Decided Design Choices (from clarifying Q&A)

1. **Drive dirty-state included in quiescence gate.** Reload defers while `_atomicOpsDepth > 0` OR `_pendingUploadKey != null`, in addition to in-flight HTTP. Matches `beforeunload` protections.
2. **Restore payload contents:** `panX`, `panY`, `zoom`, `hoveredNodeId`, `currentView`, `currentWeekKey`. Open panel state is **not** captured — quiescence rule guarantees panels are closed at reload time.
3. **Telemetry:** `console.debug` only, behind no flag. Three event names: `update-detected`, `reload-deferred` (with `reason`), `reload-fired`.
4. **Spec location:** `docs/specs/quiet-refresh.md` (this file), alongside existing specs.
5. **Versioning scheme:** CalVer `vYYYY.MM.DD` (e.g., `v2026.05.10`), with optional same-day build counter `vYYYY.MM.DD.N` (e.g., `v2026.05.10.1`, `v2026.05.10.2`) when more than one release ships in a single day. Driven by git tags. New release = create + push a tag; Vercel build resolves it via `git describe --tags --abbrev=0` and substitutes the `__APP_VERSION__` placeholder in `zenit-week.html` before deploy. Never edited manually.
6. **Freshness signal:** ETag only. The injected version string changes byte-for-byte on every tagged deploy, which guarantees an ETag delta — but the comparison logic reads ETag, not version. Version is purely a human-readable label.
7. **Version display:** rendered into the Help panel footer (`#help-content`) via `textContent`. Single location.

## 8. Open Questions Deferred to Implementation

- Exact wording of the cache-buster (`?v=<timestamp>` vs `?v=<last-known-etag>`) — pick one in PR, document in code comment.
- Whether to also persist `currentLang` / `theme` in the restore payload — currently restored eagerly from their own keys, so probably no, but verify during build that there's no flash.
- Whether to add a `quietRefresh.forceCheck()` debug helper on `window` for manual testing. Likely yes, gated by a build-time `false` constant or simply documented and left in.

## 9. Acceptance Checklist (for `/plan` → `/build`)

- [ ] `vercel.json` updated (Cache-Control + `buildCommand: "npm run build"`); verified via `curl -I` on production URL.
- [ ] `package.json` has `scripts.build = "node scripts/inject-version.js"`.
- [ ] `scripts/inject-version.js` exists, unit-tested, fails loud on missing placeholder.
- [ ] `zenit-week.html` contains exactly one `__APP_VERSION__` placeholder in committed source.
- [ ] Help panel footer renders the resolved version via `textContent`.
- [ ] `checkForAssetUpdate()` + `isAppQuiescent()` + `tryQuietReload()` + restore-on-load implemented in `zenit-week.html`.
- [ ] Wired into `visibilitychange`, `focus`, and all relevant transition handlers.
- [ ] Unit tests for `parseAssetVersionHeaders`, `isAppQuiescent`, restore payload round-trip, and `inject-version.js` pass.
- [ ] Manual matrix from §5 passes on desktop Chrome + iOS Safari standalone.
- [ ] Reload-loop test passes (broken deploy reloads once, not twice).
- [ ] First tag-push e2e test: `git tag v2026.05.11 && git push --tags` → Vercel build succeeds → production HTML contains `v2026.05.11`, not the placeholder.
- [ ] `console.debug` events fire as specified; no other UI surface.
- [ ] LOC budget: ≤ ~120 lines added to `zenit-week.html` (idea doc estimated 50–70; allow headroom for tests-driven structure). `scripts/inject-version.js` ≤ 30 LOC.

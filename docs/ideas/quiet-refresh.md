# Quiet Refresh — Silent App Update for Zenit Week

## Problem Statement
**How might we** ensure users on installed/home-screen webclips (especially iOS) reliably run the latest version of Zenit Week, without forcing intrusive reloads or interrupting work in progress?

## Recommended Direction

**Quiet Refresh + Invisible Restore.** On every `visibilitychange` (and `focus`), perform a low-cost `HEAD` request against `/zenit-week.html` with a cache-busting query param, comparing the response `ETag` / `Last-Modified` against a value cached in `localStorage`. If the asset has changed, the app waits for a *quiescent* moment — no editing, no panning, no open dialog, no in-flight Drive upload — then persists volatile view-state (pan, zoom, selection, current view) and calls `location.reload()`. On the fresh load, the persisted state is restored, making the reload visually indistinguishable from "nothing happened."

This approach fits the existing architecture: it piggybacks on lifecycle hooks already in place (`zenit-week.html:3949`, `10557`), reuses the ETag-conditional-fetch idiom already used in Drive sync (`zenit-week.html:4403`), and keeps the single-file policy intact. The net change is roughly 50–70 LOC, no new files, no build step, no backend.

Rejected alternatives: (a) a service-worker–based PWA was rejected because it violates the project's Single File Policy and because iOS Safari's SW caching is itself a known source of staleness — "solving cache with cache" is the wrong shape. (b) Notification banners ("New version available, tap to reload") were rejected because the user explicitly chose silent auto-update; banners add friction without proportional benefit for a single-user planner app.

## Key Assumptions to Validate

- [ ] **Vercel serves stable ETag / Last-Modified for `/zenit-week.html`.** Test: `curl -I https://<deployed-url>/app` once; confirm headers are present and change after a deploy.
- [ ] **iOS Safari standalone honors the cache-buster on `fetch()`.** Test: install to home screen on real iPhone, deploy a visible change, return to app — verify the HEAD request returns the new ETag (DevTools via remote inspector or in-app debug log).
- [ ] **Quiescence gate covers every "user is mid-task" case.** Enumerate: `_editing` node, `isPanning`, open context menu, open settings/help/todo/daily-log panel, open color picker, open `#app-confirm-overlay`, in-flight Drive upload, in-flight undo replay. Test: artificially flip `pendingReload` during each state, confirm reload defers.
- [ ] **View-state round-trip is lossless.** Pan, zoom, selected node, current view, current week, scroll position of side panels all survive a reload-and-restore cycle pixel-identically.
- [ ] **No reload loop.** If a new version itself fails to start, app must not re-detect "new version" and reload again. Mitigation: store the *new* ETag *before* reload, not after.

## MVP Scope

**In:**
- `checkForUpdate()` — `fetch('/zenit-week.html?v=' + Date.now(), { method: 'HEAD', cache: 'no-store' })`, compare `ETag` (fallback `Last-Modified`) to value in `localStorage` key `zenit-week-asset-etag`. On change, set `pendingReload = true` and immediately store new ETag.
- Wire into existing `visibilitychange` and `focus` listeners. Also fire once on initial load (so first-ever check seeds the baseline ETag without reloading).
- `isAppQuiescent()` — single predicate enumerating the states above. Returns boolean.
- `tryQuietReload()` — if `pendingReload && isAppQuiescent()`, persist view-state to `zenit-week-pending-restore` and call `location.reload()`. Called at the end of each user-interaction handler that might transition the app *into* quiescence (edit-stop, pan-end, dialog-close, sync-complete).
- Restore-on-load — early-init reads `zenit-week-pending-restore`, applies pan/zoom/selection/view, clears the key.
- Cache-control header in `vercel.json` for `/zenit-week.html` and `/app(.*)`: `public, max-age=0, must-revalidate`. Belt-and-braces — keeps revalidation working even outside the in-app check.

**Out:**
- Service worker / `sw.js`.
- `manifest.json` and full PWA install (could be added later as a separate UX improvement; freshness mechanism doesn't depend on it).
- Periodic timer-based polling.
- User-facing "Check for updates" button (silent design — but trivial to add later as a fallback in settings).
- Update banner / toast UI.
- Differential / hot-reload (no preact-refresh-style trickery; full page reload is the contract).

## Not Doing (and Why)

- **Service worker** — violates Single File Policy; iOS standalone SW caching is itself a major source of staleness bugs; pure overhead for an app that already does its persistence through Drive + IndexedDB.
- **Manifest.json / proper PWA install** — orthogonal to freshness; bundle it as a separate UX initiative if the install-feel matters. Don't blur scopes.
- **Build-time version stamping** — user explicitly excluded build-step mutations; CDN-provided ETag covers the same need with zero build complexity.
- **`/version.txt` poll** — equivalent to ETag-on-HTML, but adds a second source of truth that can drift. ETag of the HTML *is* the version.
- **Update banner / toast** — user picked silent auto-update; surfacing the reload defeats the goal. Re-introducing a banner later remains an option if "silent" turns out to be too jarring.
- **Periodic timer poll** — covered well enough by visibility/focus; mobile users flip apps often, desktop users at least switch tabs. Avoids waking the JS engine on hidden tabs.
- **Reload mid-edit "with confirmation"** — quiescence-defer is simpler and safer than asking the user. If we ever can't get to a quiet moment, the next page open will catch the update anyway.

## Open Questions

- Should the quiescence gate also defer on "Drive sync has uncommitted local changes" (i.e., dirty local state not yet uploaded)? Probably yes — flushing first avoids any risk of an in-memory state being newer than the persisted state. Verify what `beforeunload` (`zenit-week.html:10573`) already does.
- What's the right `zenit-week-pending-restore` schema — flat object, JSON-stringified? Should it include language / theme, or are those already restored eagerly enough that we don't need to re-apply?
- Should the cache-buster on the HEAD request use `?v=<timestamp>` or `?v=<last-known-etag>`? Latter is slightly nicer to CDN cache but the difference is negligible at this scale.
- Telemetry / debuggability: log update-detected and reload-deferred events to `console.debug` so we can diagnose user reports without adding a UI?

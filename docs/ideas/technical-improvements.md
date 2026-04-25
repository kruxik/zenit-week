# Technical Debt & Architecture Improvements

This document tracks identified technical improvements for the Zenit Week application to ensure long-term stability, security, and performance.

## 1. Security: XSS Mitigation (Critical)
**Issue:** Activity and todo item labels were migrated to `textContent` (fixed). Branch labels still use `innerHTML` in two places: the Summary panel (line ~5993) and the Daily log legend (line ~6027), e.g. `row.innerHTML = \`...\${b.label}:\``.
**Risk:** A branch name containing `<script>` or an `onerror` attribute executes in the page. This is directly reachable via Google Drive sync — a tampered Drive file with a malicious branch label survives `validateAndRepair` and reaches these `innerHTML` calls.
**Recommendations:**
- Replace the two remaining `innerHTML` template literals that embed `b.label` with DOM construction (`createElement` + `textContent`) or introduce a small `escapeHtml(str)` utility and apply it to every user-controlled string passed to `innerHTML`.

## 1a. Security: Drive Data Label Sanitization (High)
**Issue:** `validateAndRepair()` performs structural garbage collection (orphan cleanup, dead child references) but does not sanitize string fields on nodes. Any string stored in `label`, `branch`, or similar fields on a remote Drive file is applied to the DOM as-is.
**Risk:** An attacker who can write to the user's Google Drive `appDataFolder` (e.g. via a compromised Google session or a malicious app with Drive scope) can inject XSS payloads that survive the repair pass and reach `innerHTML` renders.
**Recommendations:**
- Add a string-field sanitization pass inside `validateAndRepair` that truncates labels beyond a max length and strips/encodes HTML-special characters (`<`, `>`, `"`, `&`).
- Alternatively, fix all `innerHTML` call-sites (see §1) so raw label strings are never treated as HTML — this is the higher-leverage fix.

## 1b. Security: Content Security Policy (Medium)
**Issue:** No `Content-Security-Policy` meta tag exists. The app loads two external scripts from Google (`accounts.google.com`, `apis.google.com`) without any policy restricting what else can load.
**Risk:** If XSS is ever exploited, the absence of CSP means scripts can freely exfiltrate data to any origin.
**Recommendations:**
- Add a `<meta http-equiv="Content-Security-Policy">` tag to `<head>` allowing at minimum:
  ```
  default-src 'self';
  script-src 'self' https://accounts.google.com https://apis.google.com;
  connect-src 'self' https://www.googleapis.com https://accounts.google.com;
  img-src 'self' data: https:;
  style-src 'self' 'unsafe-inline';
  ```
- Note: inline `<script>` blocks require either `'unsafe-inline'` or per-block nonces; evaluate whether the favicon inline script can be moved to an external file or replaced with a hash.

## 1c. Security: Drive Colors File Theme Validation (Low)
**Issue:** When syncing the colors/settings file from Drive, `remoteData.theme` is written directly to `localStorage` and applied to `document.documentElement.dataset.theme` (line ~3710) without checking that the value is `'light'` or `'dark'`.
**Risk:** An arbitrary string in `dataset.theme` could match unintended CSS attribute selectors; combined with `'unsafe-inline'` styles it widens any XSS surface.
**Recommendations:**
- Validate before applying: `if (['light', 'dark'].includes(remoteData.theme))` — reject anything else.
- Same pattern for `remoteData.lang`: validate it is a known locale key before setting `currentLang`.

## 1d. Security: Label Length Cap (Low)
**Issue:** Node labels are only `.trim()`'d before saving (line ~4892). No maximum length is enforced.
**Risk:** An unbounded label is an unbounded `localStorage` write. A crafted import or Drive file with very large labels could push storage toward the browser's ~5–10 MB per-origin limit, causing silent data loss on the next save.
**Recommendations:**
- Enforce a reasonable cap (e.g. 200 characters) in `renameNode` and in `validateAndRepair`'s string-sanitization pass (see §1a).

## 2. Performance: Rendering & Layout
**Issue:** `render()` performs a full SVG rebuild on every change, and `computeLayout()` runs frequently.
**Recommendations:**
- **Surgical DOM Updates:** Expand the usage of `updateNodeUI` to cover more state changes without a full re-render.
- **Layout Caching:** Only re-calculate `computeLayout()` when the tree structure (parent/child relationships) changes.
- **Intersection Observer:** For extremely large maps, consider partial rendering or culling of off-screen SVG elements.

## 3. Architecture: State & Modularity
**Issue:** ~5,800 lines in a single file with heavy reliance on global state.
**Recommendations:**
- **Store Pattern:** Centralize `weekData` management into a dedicated `Store` class/object to handle snapshots, persistence, and state transitions.
- **Namespacing:** Group related functions (e.g., `SVGUtils`, `LayoutEngine`, `EventHandlers`) into objects to reduce global namespace pollution.
- **Structured Cloning:** Replace `JSON.parse(JSON.stringify(obj))` with the native `structuredClone(obj)`.

## 4. History System: Action Deltas
**Issue:** Full JSON snapshots for undo/redo are memory-intensive (100 levels).
**Recommendations:**
- Transition from "State Snapshots" to "Action Deltas" (Command Pattern).
- Store only the change (e.g., `oldValue` vs `newValue`) for specific node properties.

## 5. Accessibility (A11y)
**Issue:** The SVG mind map is currently invisible to screen readers.
**Recommendations:**
- Add ARIA roles (`tree`, `treeitem`) to SVG groups.
- Ensure keyboard focus management follows the visual selection.
- Add `aria-live` regions for status updates (e.g., "Task marked as done").

## 6. Maintenance
**Issue:** The single-file constraint is helpful for distribution but difficult for development.
**Recommendations:**
- Consider a build step that allows developing in separate files while still outputting a single `zenit-week.html` for the user.

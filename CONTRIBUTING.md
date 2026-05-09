# Contributing to Zenit Week

Thanks for taking a look. Zenit Week aims to stay simple, portable, and visually rich. The single-file architecture is the unusual constraint — most of the project's design choices flow from it.

## How to run

1. Clone the repository.
2. Open `zenit-week.html` in any modern browser — no server required for the app itself.
3. To work on Google Drive sync locally, run `vercel dev` (you'll need a `.env.local` based on `.env.local.example` for the OAuth client secret).
4. To run the test suite and HTML validator:

   ```sh
   npm install         # only needed once
   npm test            # vitest
   npm run validate    # html-validate
   ```

## Principles

- **Single-file policy.** The entire app must remain within `zenit-week.html`. This is the project's defining constraint — it makes Zenit Week a portable utility anyone can download, audit, and run offline. Don't split it.
- **Vanilla only.** No frameworks (React, Vue, Tailwind, etc.). Standard HTML5, CSS3, ES6+ JavaScript. SVG for graphics. The marketing pages (`index.html`, `cs/index.html`) follow the same rule.
- **Privacy.** No servers, no analytics, no tracking. User data lives on their device (`localStorage` / `IndexedDB`) or in their own Google Drive. Never on our infrastructure. The only server-side code (`api/token.js`) exists solely to keep the OAuth client secret out of the browser.
- **No browser dialogs.** Don't use `alert()`, `confirm()`, or `prompt()`. Use the in-app `showAppConfirm({ title, body, okLabel, danger, onConfirm })` helper, or follow the `#app-confirm-overlay` / `#app-confirm-dialog` pattern.
- **No XSS surfaces.** Never assign user-controlled strings (node labels, branch names, anything from `weekData` or Drive) to `innerHTML`, `outerHTML`, or `insertAdjacentHTML`. Use `textContent`, `createTextNode()`, or DOM construction. The only acceptable `innerHTML` use is with fully static, code-defined strings (e.g. icon SVGs).

## Architecture

### Repository layout

| Path | Purpose |
| :--- | :--- |
| `zenit-week.html` | The entire app — HTML, CSS, JS, SVG icons, all in one file. |
| `index.html`, `cs/index.html` | Marketing homepages (English & Czech). |
| `privacy.html`, `terms.html` | Legal pages. |
| `api/token.js` | Vercel Edge Function that proxies the Google OAuth token exchange to keep `client_secret` server-side. PKCE on the client. |
| `tests/` | Vitest suite — focused on data logic (week math, transfers, validation, sync conflict resolution). |
| `docs/specs/`, `docs/plans/`, `docs/ideas/` | Specs, implementation plans, idea sketches. |
| `og-image*.{svg,png}`, `screenshot.{svg,png}` | Marketing & share assets. |
| `vercel.json` | Routes for `/app`, `/privacy`, `/terms`. |
| `sitemap.xml`, `robots.txt` | SEO essentials. |

### Data model

```js
weekData = {
  nodes: [
    { id, type, branch, label, parent, children,
      done, unplanned, priority, reusable, offX, offY, side, _editing,
      // counter nodes only:
      val, max, ticks,        // ticks: ISO timestamp per increment (drives daily log)
      // timestamps:
      doneAt,                 // set when marked done
      unplannedAt,            // set when marked unplanned
      _ts                     // epoch ms — Drive merge conflict resolution
    }
  ]
}
```

Each week is one such object, keyed in storage by ISO week (`YYYY-WW`).

### Node hierarchy

| Type | Description |
| :--- | :--- |
| `center` | Virtual root (the week label itself). |
| `branch` | User-managed top-level category. Defaults to *Work*, *Family*, *Me*. Can be added or deleted; one must always remain. |
| `activity` | A user-created task. May have `counter` children. |
| `counter` | Auto-created when an activity label matches the `Nx` pattern (e.g. `Pushups 10x`). Tracks `val` / `max`, with `ticks` recording each increment. |

`BRANCH_CONFIG` maps a branch id to `{ side: 'left' | 'right' }`, controlling radial layout placement.

### Storage

The app uses both `localStorage` and `IndexedDB`:

| Key / DB | Contents |
| :--- | :--- |
| `zenit-week-YYYY-WW` | One week's `weekData`, JSON-encoded. (Migration in progress to IndexedDB.) |
| `zenit-week-db` (IndexedDB) | Newer storage target for plan data. |
| `zenit-week-theme` | `light` or `dark`. |
| `zenit-week-lang` | `en` or `cs`. |
| `zenit-week-colors` | Per-branch color overrides. |
| `zenit-week-autolayout` | `true` / `false`. |
| `zenit-week-google-auth` | Google OAuth refresh token (only after sign-in). |
| `zenit-week-reset-token` | Per-device token for sync conflict resolution. |
| `zenit-week-storage-migrated` | One-shot migration flag. |

### Rendering pipeline

- **`render()`** — full re-render. Call on structural changes only (add/remove/move).
- **`updateNodeUI(id)`** — surgical visual update for a single node. Use this for status toggles, label edits, color changes — anything that doesn't change topology.
- **`updateSummary()`** — refreshes the stats panel.
- **`computeLayout()`** — calculates radial positions. Recursive height + priority-based scaling (critical: 2.0x, high: 1.5x, normal: 1.0x). Branches split left/right per `BRANCH_CONFIG`.

### Key functions

| Function | Notes |
| :--- | :--- |
| `findNode(id)` | O(1) lookup via `nodeMap` (a `Map<id, node>`, rebuilt on every structural change). |
| `genId()` | Generates a node id via `crypto.randomUUID()`, with a `crypto.getRandomValues` fallback for plain-HTTP contexts. **Always call this — never `crypto.randomUUID()` directly.** |
| `getDescendantIds(id)` | Recursively collects a subtree. |
| `validateAndRepair()` | Garbage collection + orphan cleanup. Run on load and after imports. |
| `transferUnfinished()` | Copies incomplete activities from the previous ISO week to the current one. |
| `transferReusable()` | Copies nodes marked `reusable: true` (with counters reset) to the current week. |
| `moveNodeToNextWeek(id)` | Moves a single node and its subtree into the next ISO week. |
| `addBranch(side)` / `deleteBranch(id)` | Dynamic branch management. |
| `applyBranchColor(branch, hex)` | Updates the branch palette and re-renders. |
| `syncStatusUp(id, prop)` | Propagates `done` / `unplanned` status up the tree after a child changes. |

### Cascading behaviors

- **Done** and **priority** changes cascade to all descendants.
- **Counter** nodes auto-mark their activity parent done when reaching `max`.

## Development workflow

1. **Edit** `zenit-week.html` directly.
2. **Test in the browser** — refresh and manually verify drag-and-drop, zoom/pan, undo/redo, and `localStorage` persistence across refreshes.
3. **For data-logic changes**, also run the automated suite:

   ```sh
   npm test
   npm run validate
   ```

4. **Code style**
   - Always `'use strict';`.
   - `const` and `let`, never `var`.
   - camelCase for JS; kebab-case for IDs and CSS classes.
   - SVG elements via `document.createElementNS('http://www.w3.org/2000/svg', tag)`.
   - Keep CSS in the `<style>` tag, JS in the `<script>` tag.

## Submitting changes

1. Create a branch.
2. Make focused commits — one logical change per commit. Conventional Commits format (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`) is preferred.
3. Open a PR with a clear description of what changed and why. Screenshots help for UI changes.

## Testing

- Vitest suite is in `tests/`. Add tests for any new data logic (week math, sync, repair, transfers).
- HTML validation runs against `zenit-week.html` only.
- Manual: golden-path test the feature end-to-end in the browser plus at least one edge case.

## Reporting issues

Use the GitHub issue tracker. Include browser + OS version. For sync issues, also note whether you were signed into Google.

# Plan: Node Comments

Spec: `docs/specs/node-comments.md` · Idea: `docs/ideas/node-comments.md` · Target: `zenit-week.html`

## Dependency graph

```
T1 assets (icon-message symbol + i18n "Comment")
   ├──> T2 context-menu item + dialog shell
   │        └──> T3 dirty-check auto-save (+ undo/_ts/persist)
   │                 ├──> T4 mind-map indicator icon
   │                 └──> T5 agenda-row indicator icon
   └──> (T4/T5 also need the symbol)
T6 data integrity + tests  ──> depends on T3 (write path)
```

Critical path: **T1 → T2 → T3 → T4 → T5**. T6 lands after T3, runs in parallel with T4/T5 if desired.

## Vertical slicing rationale

Each task is one complete path, not a horizontal layer:
- T1 is the only "enabling assets" task — atomic prereqs (sprite symbol, translation key) that are trivially verifiable on their own and shared by later slices.
- T2+T3 together deliver the **complete create/edit/clear path** through the context menu (the sole entry point), independent of any icon.
- T4 and T5 each add one display surface end-to-end.
- T6 hardens persistence/merge and adds automated coverage.

The app stays runnable and shippable after every task.

---

## Phase 1 — Core create/edit path

### T1 — Enabling assets: `icon-message` symbol + i18n key
- Add Tabler `<symbol id="icon-message">` to the SVG `<defs>` sprite (~line 2843+).
- Add `menu.comment` translation (EN: "Comment", CS: e.g. "Komentář") in `TRANSLATIONS`, placed near `menu.rename`.
- **AC:** `<use href="#icon-message">` renders a visible message glyph in light + dark; switching language updates a probe element bound to `menu.comment`.
- **Verify:** temporary `<use>` in a node renders correctly; `t('menu.comment')` returns the right string per `currentLang`. Remove the probe before commit. `npm run validate` clean.
- **Deps:** none.

### T2 — Context-menu "Comment" item + dialog shell (no save yet)
- Static `<div class="ctx-item" id="ctx-comment">` immediately after `#ctx-rename` (line 3045), labeled via `data-i18n="menu.comment"`, icon `#icon-message`.
- Show/hide wiring: visible only for `type === 'activity'`; hidden for center/branch/counter (follow existing type-specific show/hide).
- New dialog mirroring Help (`#comment-overlay` / `#comment-panel`): CSS cloned from `#help-*` block (~2053–2178) for desktop centered panel + mobile full-area + bottom "Close" pill; markup after help panel (~3220).
- Caption = node label via `textContent`. Body = single full-area `<textarea>`. Soft char counter at 1000 (warning style past threshold). Close via X / Close pill / `Esc`.
- On open: pre-fill textarea with `node.comments || ''`. On close in this task: just close (discard) — no persistence yet.
- **AC:** menu item appears after "Rename" on activities only; selecting opens dialog with current text; layout correct at <768px (full area + pill) and ≥768px (centered ~592px); caption shows label literally incl. `< & "`; counter flips to warning past 1000; Esc/X/pill all close.
- **Verify:** manual browser, both themes, both langs, both breakpoints; right-click branch/counter/center → no "Comment" item.
- **Deps:** T1.

### T3 — Dirty-check auto-save (undo + `_ts` + persist)
- On close, compare textarea value to stored `node.comments`:
  - **changed:** `takeSnapshot()` (note: real fn — `pushHistory` does not exist, `zenit-week.html:3774`) → write `node.comments = value` (empty string clears) → bump `node._ts = Date.now()` → persist to localStorage → refresh affected UI (surgical where possible).
  - **unchanged:** no snapshot, no `_ts` bump, no write.
- **AC:** edit→close→reopen shows new text; clearing all text removes the comment (field empty); Ctrl/⌘+Z restores prior text and redo re-applies; open→close with no edit leaves undoStack length and `_ts` unchanged; survives page refresh.
- **Verify:** manual — type/close/reopen; undo/redo; inspect `weekData` node `_ts` before/after a no-op close (unchanged); refresh persistence.
- **Deps:** T2.

> **🔲 Checkpoint A** — full create/edit/clear path works via context menu, with undo and persistence, before any indicator UI. Review behavior + diff with user.

---

## Phase 2 — Presence indicators (display-only)

### T4 — Mind-map indicator icon
- In badge-row block (~7807–7848): when activity node has non-empty `comments`, append a decorative `<use href="#icon-message">` on the node's right, after priority/unplanned/reusable badges; `pointer-events:none`.
- Factor its width into `rightW` and the `textX` centering so label + badges stay centered.
- Toggle via surgical update when a comment is added/cleared (avoid full `render()` if the existing visual-only update path allows).
- **AC:** icon appears only when `comments` non-empty; disappears when cleared; clicking it does nothing; label+badges remain centered with icon present; renders correctly with priority/unplanned/reusable also present.
- **Verify:** manual — add/clear comment, observe icon; click icon (no-op); visual centering check with combinations of badges; light + dark.
- **Deps:** T1, T3.

### T5 — Agenda-row indicator icon
- In agenda row render (before the drag handle, near `iconSvg('grip-vertical')` ~10901): show `#icon-message` on the row's right when activity has non-empty `comments`.
- **AC:** icon appears/disappears with comment presence in agenda view; not clickable; alignment consistent with existing row icons.
- **Verify:** manual — toggle comment, switch to agenda, observe; both themes.
- **Deps:** T1, T3.

> **🔲 Checkpoint B** — presence is visible in both map and agenda; icons are inert. Review with user.

---

## Phase 3 — Data integrity & tests

### T6 — `validateAndRepair` tolerance + Drive merge + vitest
- `validateAndRepair()`: tolerate `comments` on activities; strip it if it ever appears on center/branch/counter.
- Confirm Drive export/import and per-node `_ts` merge preserve/replace `comments` correctly (set, edit, clear-wins-when-newer).
- vitest: field persistence round-trip; repair strips from non-activity; merge keeps higher-`_ts` `comments`; clear (newer `_ts`) beats older non-empty.
- **AC:** `npm test` green incl. new cases; `npm run validate` clean; no regressions in existing suites.
- **Verify:** `npm test`, `npm run validate`. Manual Drive sync sanity if a second device/profile is handy.
- **Deps:** T3.

> **🔲 Checkpoint C (final)** — full feature verified: create/edit/clear, undo, indicators, persistence, sync, tests green, both langs/themes, desktop + mobile. XSS spot-check (`<script>`/`&`/quotes in label + comment render as literal text). Hand off / ship.

---

## Out of scope (deferred — do not build)

Clickable icons · keyboard shortcut · markdown/rich text · comment history · per-comment timestamps · comments on non-activity nodes · hard char limit · hover tooltip.

---

## Todo checklist

- [x] **T1** — `icon-message` symbol + `menu.comment` i18n (EN/CS)
- [x] **T2** — `#ctx-comment` menu item (activity-only) + Help-style dialog shell (open/close/caption/textarea/counter)
- [x] **T3** — dirty-check auto-save: `takeSnapshot` → write `comments` → `_ts` bump → persist → undo/redo
- [x] 🔲 Checkpoint A — review core path
- [x] **T4** — mind-map indicator icon (display-only, centering math)
- [ ] **T5** — agenda-row indicator icon (display-only)
- [ ] 🔲 Checkpoint B — review indicators
- [ ] **T6** — `validateAndRepair` tolerance/strip + Drive merge + vitest
- [ ] 🔲 Checkpoint C — final verification + ship

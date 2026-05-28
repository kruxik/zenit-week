# Spec: Node Comments

Status: Draft · Source idea: `docs/ideas/node-comments.md` · Target file: `zenit-week.html` (single-file app)

## 1. Objective

Let users attach a freeform plain-text note to any **activity** node so personal context, thoughts, and annotations persist for the week without cluttering the mind map.

- **Target users:** existing Zenit Week users planning their week on desktop and mobile.
- **Value:** capture detail that doesn't belong in a short node label; survives across refresh (localStorage) and devices (Drive sync).
- **Non-goals:** rich text, threaded/multi-comments, history, comments on structural nodes.

## 2. Commands

No new build tooling. Existing workflow applies:

```sh
npm install        # once
npm test           # vitest — data-logic changes (comments field, merge, snapshot)
npm run validate   # html-validate
# manual: open zenit-week.html in a browser
```

Acceptance verification is manual-in-browser plus vitest for the data-model parts.

## 3. Data model

Add one optional field to **activity** nodes only:

```javascript
{ /* …existing activity node… */ comments: '<plain UTF-8 string>' }
```

Rules:
- Absent / empty string ⇒ node "has no comment". Only non-empty `comments` triggers the indicator icon.
- Never set on `center`, `branch`, or `counter` nodes.
- On save: bump `node._ts = Date.now()` (existing pattern, `zenit-week.html:7004,7049`) so Drive last-`_ts`-wins merge handles concurrent edits with no new merge code.
- `validateAndRepair()` must tolerate the field (and strip it from non-activity nodes if it ever appears there).

## 4. Project structure (where each piece lives in `zenit-week.html`)

Single-file policy — no new files. Insertion points (verified against current code):

| Piece | Location |
|---|---|
| `icon-message` Tabler `<symbol>` | SVG `<defs>` sprite, ~line 2843+ |
| Comment dialog CSS (overlay + panel, mobile/desktop, close pill) | `<style>` head, mirror `#help-*` block ~2053–2178 |
| Comment dialog markup (`#comment-overlay`, `#comment-panel`, caption, textarea, close) | after the help panel markup ~3220 |
| Context-menu item `#ctx-comment` | static menu, immediately after `#ctx-rename` (`zenit-week.html:3045`) |
| Mind-map indicator icon | badge-row block ~7807–7848 |
| Agenda-row indicator icon | agenda row render (before drag handle, near `iconSvg('grip-vertical')` ~10901) |
| Open/close/save dialog logic + show/hide menu item + i18n keys | JS section alongside related handlers |

## 5. Core features & acceptance criteria

### F1 — Context-menu entry (sole create + edit path)
- New item **"Comment"** (singular), inserted right after "Rename".
- Visible **only** on activity nodes; hidden for center/branch/counter (follow existing show/hide pattern for type-specific items).
- Selecting it opens the Comment dialog pre-filled with the node's current `comments` (empty for none).
- **AC:** right-click/long-press an activity → "Comment" appears after "Rename"; on a branch/counter/center it does not appear. Click opens dialog with existing text.

### F2 — Comment dialog (Help-style large panel)
- Mirrors Help dialog (`#help-overlay`/`#help-panel`).
  - Desktop ≥768px: centered floating panel (~592px wide, near-full height, rounded, shadow).
  - Mobile <768px: covers whole area below the toolbar; bottom floating "Close" pill replaces top-right X (mirror `#help-close-bar` behavior).
- **Caption:** the node's label, set via `textContent` (never `innerHTML`).
- **Body:** a single `<textarea>` filling the inner area; plain UTF-8 incl. emojis.
- **Soft character counter** at 1000 chars (warning style past the threshold; no hard cap, no truncation).
- Close via X (desktop) / Close pill (mobile) / `Esc`.
- **AC:** dialog opens at correct size on both breakpoints; caption shows the exact node label including special chars (e.g. `<b> & "x"`) rendered literally; typing + Esc closes and persists; counter turns to warning past 1000 but still saves.

### F3 — Auto-save on close (with dirty check)
- On close, if textarea text **differs** from the node's stored `comments`:
  - call `takeSnapshot()` **before** overwriting (real history fn — `pushHistory` does not exist; `zenit-week.html:3774`),
  - write trimmed-of-nothing raw value to `node.comments` (empty string ⇒ clears the comment),
  - bump `_ts`, persist to localStorage, refresh affected UI.
- If text is **unchanged**, do nothing (no snapshot, no `_ts` bump) — opening/closing must not pollute undo or trigger a Drive sync.
- **AC:** edit → close → reopen shows new text; Ctrl/⌘+Z restores previous text; open→close with no edit leaves undo stack and `_ts` untouched.

### F4 — Display-only indicator icon
- `icon-message` shown **only** when `comments` is non-empty. Purely a presence signal — **not clickable**, no hover tooltip.
- **Mind map:** decorative `<use>` on the node's right, after the priority/unplanned/reusable badge row; `pointer-events:none`; its width factored into the badge-row `rightW`/`textX` centering so the label+badges stay centered.
- **Agenda:** icon on the row's right, before the drag handle.
- **AC:** adding a comment makes the icon appear in both views without full reload glitches; clearing the comment removes it; clicking the icon does nothing; node label + badges remain visually centered with the icon present.

### F5 — i18n
- New key for "Comment" menu label in EN + CS (`TRANSLATIONS`, follow `menu.rename` placement). Any dialog caption fallback / counter label also keyed.
- **AC:** switching language updates the menu item and dialog chrome.

### F6 — Persistence & sync
- `comments` round-trips through localStorage per ISO week and through Drive export/import.
- **AC (vitest where logic-testable):** node with `comments` serializes/deserializes intact; Drive merge keeps the higher-`_ts` version's `comments`; clearing on one device (newer `_ts`) wins over older non-empty.

## 6. Code style

Per CLAUDE.md (these are hard constraints):
- `'use strict';`, `const`/`let`, camelCase.
- **No `innerHTML`/`outerHTML`/`insertAdjacentHTML` with user data.** Comment text and node label are user data → textarea `.value`, `textContent`, `createTextNode`. `innerHTML` only with static constant strings (e.g. `iconSvg()`).
- SVG via `document.createElementNS(...)` / existing `svgEl()` helper.
- Reuse existing button/dialog classes; no new orphan classes (<5 uses). Reuse `#help-*` structure and `--accent-*` tokens.
- Surgical UI updates (`updateNodeUI`) over full `render()` where the change is visual-only (indicator toggle).
- Use `genId()` (not needed here — no new nodes — but never call `crypto.randomUUID()` directly).

## 7. Testing strategy

- **vitest (data logic):** comments field persistence, `validateAndRepair` tolerance + strip-from-non-activity, Drive `_ts` merge for comments (set, edit, clear).
- **Manual (browser, both themes, both languages, desktop + mobile widths):**
  - menu item visibility per node type;
  - dialog layout/caption/textarea/counter/close on desktop & mobile;
  - auto-save + dirty-check behavior; undo/redo;
  - indicator appear/disappear in map and agenda; centering with icon present;
  - emoji + special-char content renders literally (XSS check: label/comment with `<script>`/`&`/quotes shows as text).
- `npm run validate` passes (no html-validate regressions).

## 8. Boundaries

**Always do**
- Comments on activity nodes only.
- Custom dialog (Help-style) — never native `confirm/alert/prompt`.
- `textContent` for all user data; `takeSnapshot()` before mutating; `_ts` bump on real change.
- EN + CS i18n for any new user-facing string.
- End with a one-line commit message and ask before committing.

**Ask first**
- Any change to the indicator's interactivity (currently display-only) or adding a hover tooltip.
- Adding a keyboard shortcut.
- Touching the Help dialog's own CSS/markup (reuse pattern, don't refactor it as a side effect).
- Raising/lowering the 1000-char soft threshold or adding a hard cap.

**Never do**
- Split into additional files (single-file policy).
- `innerHTML`/`insertAdjacentHTML` with comment text or node labels.
- Comments on center/branch/counter nodes.
- Markdown/rich-text, comment history/versioning, multi-comments, or per-comment timestamps in this scope.
- Make the icon clickable or add new orphan CSS classes.

## 9. Out of scope (deferred)

Clickable icons · keyboard shortcut · markdown/rich text · comment history · per-comment timestamps · comments on non-activity nodes · hard character limit · hover tooltip.

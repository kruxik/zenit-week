# Node Comments

## Problem Statement
How might we let users attach freeform notes to activity nodes so personal context, thoughts, and annotations survive the week without cluttering the visual map?

## Recommended Direction

Add an optional `comments` string field to activity nodes (not center, branch, or counter).

**Creation & editing — context menu only.** A new context-menu item **"Comment"** (singular) is inserted directly after "Rename", visible on activity nodes only. It is the single entry point for both creating and editing: selecting it opens the Comment dialog pre-filled with the node's current `comments` text (empty for a node with none). There is no map/agenda affordance to *create* a comment — the icon below is purely a "this node has a comment" indicator.

**Indicator icon (display-only, shown only when `comments` is non-empty).** A message icon (Tabler `icon-message`) signals that a node carries a comment. It is **not interactive** — it does not open the dialog; editing always goes through the context-menu "Comment" item.
- **Mind map:** right side of the node, after the existing badge row (priority / unplanned / reusable), rendered as an SVG `<use>` element following the existing badge pattern (decorative `<use>`, `pointer-events:none`, no hit-area). Its width must be factored into the badge-row `rightW` / `textX` centering math (`zenit-week.html` ~7807–7848).
- **Agenda view:** right side of the activity row, before the drag handle.

**Comment dialog (Help-style large panel).** A new overlay+panel mirroring the Help dialog (`#help-overlay` / `#help-panel`, `zenit-week.html` ~2053–2178, 3213–3220):
- **Desktop (≥768px):** centered floating panel (same geometry as `#help-panel` — ~592px wide, near-full height, rounded, shadowed).
- **Mobile (<768px):** covers the whole area below the toolbar; bottom floating "Close" pill replaces the top-right X (same `#help-close-bar` treatment).
- **Header caption:** the node's label, set via `textContent` (XSS-safe — node labels are user data), plus a close X.
- **Body:** a single `<textarea>` filling the entire inner area, plain UTF-8 text (emojis included).
- **Auto-save on close**, no explicit Save button.

**Undo/redo:** the existing history function is `takeSnapshot()` (NOT `pushHistory` — that name does not exist; `zenit-week.html:3774`). Call `takeSnapshot()` before overwriting `comments`, **only when the text actually changed** (dirty check) so opening/closing the dialog without edits does not pollute the undo stack.

**Drive sync:** `comments` lives on the node object; `node._ts = Date.now()` is bumped on save (existing pattern, e.g. `zenit-week.html:7004,7049`). Existing Drive merge logic (last `_ts` wins per node) handles concurrent edits without extra code.

## Prerequisites in current code (verified)
- `icon-message` symbol is **not** in the SVG sprite — must add a Tabler `<symbol id="icon-message">` to the `<defs>` block (~line 2843+) before any `<use href="#icon-message">` resolves.
- Context menu has `ctx-rename` (`zenit-week.html:3045`) followed by `ctx-add-child` — clean insertion point. New item needs: static `<div class="ctx-item" id="ctx-comment">`, show/hide wiring for activity-only, and a click handler.
- Mind-map badges are decorative only (no click handlers) — consistent with the display-only indicator decision; no SVG event-delegation changes needed.
- Modal must follow the custom-dialog rule (CLAUDE.md): no native `confirm/alert/prompt`. Textarea `.value` is safe; caption and any echoed text use `textContent`, never `innerHTML`.

## Key Assumptions to Validate
- [ ] SVG indicator icon is readable at the default node font size — test on mobile before finalising size
- [ ] Auto-save on dialog close feels safe to users (no accidental data loss on mis-tap)
- [ ] Soft character counter at 1000 chars is enough signal without being annoying — validate with real use

## MVP Scope

**In:**
- `node.comments` field on activity nodes
- Context-menu item "Comment" (after "Rename", activity only) — sole create + edit entry point
- `icon-message` symbol added to the SVG sprite
- Help-style Comment dialog: full-area `<textarea>`, node label as caption, soft character counter, close (X desktop / bottom pill mobile), auto-save on close
- Display-only message indicator icon in mind map (activity nodes with non-empty `comments` only), width factored into badge-row centering
- Display-only message indicator icon in agenda row (activity nodes with non-empty `comments` only)
- `takeSnapshot()` before save, gated by a dirty check → full undo/redo support
- `_ts` bump on save → Drive sync handled automatically
- i18n key for "Comment" (EN + CS)

**Out:**
- Clickable icons (icons are indicators only — edit via context menu)
- Keyboard shortcut (deferred)
- Markdown/rich text
- Per-comment timestamps or history
- Comments on center, branch, or counter nodes
- Character hard limit (soft warning only)
- Hover tooltip of comment text on the icon

## Not Doing (and Why)
- **Clickable indicator icon** — context menu is the single, consistent edit path; keeps the map non-interactive where it already is and avoids new SVG hit-area wiring
- **Keyboard shortcut** — scope creep; can be added later if requested
- **Comment history/versioning** — complexity vs. value is low; undo stack covers accidental overwrites
- **Hard character limit** — localStorage risk is negligible for typical use; a counter is friendlier
- **Hover tooltip** — display-only icon already signals presence; full text is one context-menu click away
- **Comments on center/branch/counter nodes** — branches are structural, counters auto-generated; annotation doesn't fit their purpose

## Resolved (formerly Open Questions)
- **Dialog caption** → shows the node label (set via `textContent`), so context is clear when opened without the node highlighted.
- **Hover tooltip** → not doing; the icon is a display-only presence indicator.
- **Empty-node creation path** → context-menu "Comment" item only (the indicator icon is absent until a comment exists, so it can't be the entry point).

# Node Comments

## Problem Statement
How might we let users attach freeform notes to activity nodes so personal context, thoughts, and annotations survive the week without cluttering the visual map?

## Recommended Direction

Add an optional `comments` string field to activity nodes (not root, branch, or counter). When a node has comments, a message icon (Tabler `icon-message`) appears:
- **Mind map:** right side of the node, after the existing badge row (reusable/unplanned/priority), rendered as an SVG `<use>` element following the existing badge pattern — same hit-area trick as counter buttons (transparent rect behind icon for comfortable touch target)
- **Agenda view:** right side of the activity row, before the drag handle

Tapping/clicking the icon — or selecting "Comments" from the context menu (inserted after "Rename", visible on activity nodes only) — opens a custom modal (following the `#app-confirm-overlay` pattern): a `<textarea>` for plain UTF-8 text (emojis included), auto-saves on modal close, no explicit Save button needed.

**Undo/redo:** `pushHistory()` is called before overwriting comments, so Ctrl+Z restores the previous text.

**Drive sync:** `comments` lives on the node object; `_ts` is bumped on save. Existing Drive merge logic (last `_ts` wins per node) handles concurrent edits without any extra code.

## Key Assumptions to Validate
- [ ] SVG icon is readable and tappable at the default node font size — test on mobile before finalising size
- [ ] Auto-save on modal close feels safe to users (no accidental data loss on mis-tap)
- [ ] Character counter at 1000 chars is enough signal without being annoying — validate with real use

## MVP Scope

**In:**
- `node.comments` field on activity nodes
- Context menu item "Comments" (after "Rename", activity only)
- Custom modal: `<textarea>`, character counter, close button, auto-save on close
- Message icon in mind map SVG (activity nodes with comments only)
- Message icon in agenda row (activity nodes with comments only)
- `pushHistory()` before save → full undo/redo support
- `_ts` bump on save → Drive sync handled automatically
- i18n key for "Comments" (EN + CS)

**Out:**
- Keyboard shortcut (deferred)
- Markdown/rich text
- Per-comment timestamps or history
- Comments on branch or counter nodes
- Character hard limit (soft warning only)

## Not Doing (and Why)
- **Keyboard shortcut** — scope creep; can be added later if requested
- **Comment history/versioning** — complexity vs. value is low; undo stack covers accidental overwrites
- **Hard character limit** — localStorage risk is negligible for typical use; a counter is friendlier
- **Comments on branch/counter nodes** — branches are structural, counters are auto-generated; annotation doesn't fit their purpose

## Open Questions
- Should the modal have a title showing the node label (for context)? Useful if opened from the icon — you don't see the node highlighted.
- Should a non-empty comments field also be shown as a tooltip on hover over the icon (desktop only)?

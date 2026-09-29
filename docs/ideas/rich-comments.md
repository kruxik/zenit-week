# Rich Comments

## Problem Statement
How might we let a comment carry checklists, links and emphasis — edited the way Google Docs feels, with real undo/redo on phone and desktop — without changing the plain-string data model, the Drive merge, or the app's size and security rules?

## Recommended Direction

**WYSIWYG editor over a Markdown string.** The comment stays exactly what it is today: one plain string on an activity node (`node.comments`). The string is Markdown in a small, fixed grammar. The editor parses it on open, shows formatted text with no visible markers, and writes Markdown back on autosave. Because storage does not change, `mergeWeekData` (whole node by `_ts`), the validator that strips non-string comments, the Drive format and older cached app versions all keep working — an old client simply shows readable raw Markdown.

**Engine: ProseMirror, lazy-loaded as a separate vendor file.** Measured with esbuild (minified, tree-shaken, gzip -9, 2026-09-29):

| Bundle | gzip | vs app (298 KB gzip) |
|---|---|---|
| ProseMirror core (model, state, view) | 57 KB | +19% |
| ProseMirror with history, keymap, inputrules, commands, schema-list | 67 KB | +22% |
| Lexical with equivalent features | 125 KB | +42% |

No library fits the 20 KB budget for inlining, and a hand-built editor carries the highest risk exactly where it matters (Android IME/autocorrect, caret, undo). ProseMirror gives battle-tested mobile input and Docs-like undo grouping; loading it only when the comment panel opens keeps the main file's size unchanged. The price is a narrow exception to the single-file policy, plus service-worker, integrity and release work (below).

**Our own tokenizer stays in the main file.** One pure function turns the comment string into tokens for the fixed grammar, and one DOM builder turns tokens into elements via `textContent`. They serve the Agenda row preview (which cannot wait for a lazy bundle), the plain-textarea fallback's read view, and the Markdown bridge into and out of ProseMirror. One grammar, one implementation, so preview and editor never disagree. `markdown-it` is deliberately not used — it is most of the weight and accepts HTML.

**Undo/redo.** Two layers, unchanged in relation to each other:
- *Inside the editor:* `prosemirror-history` owns text undo — Cmd/Ctrl+Z, Cmd+Shift+Z, Ctrl+Y, the macOS Edit menu, iOS shake / three-finger swipe and Android keyboard undo (all arrive as `historyUndo` / `historyRedo` input events). Steps group like Docs: a typing run ends on a pause, newline, caret jump, formatting change, paste or checkbox tick. History resets when the panel closes.
- *App undo bar:* unchanged — the first autosave of a dialog session takes one `takeSnapshot()`, so one app undo reverts the whole editing session.

**Grammar (strict micro-grammar).** One level, line-based:
- Blocks: paragraph, `#` heading, `- ` bullet, `- [ ] ` / `- [x] ` checkbox.
- Inline: `**bold**`, `*italic*`, `[text](url)`, bare-URL autolink.
- Everything else renders as literal text. No nesting, tables, images or HTML.
- Input rules as in Docs: `- ` starts a bullet, `[] ` a checkbox, `# ` a heading, closing `**` applies bold; Cmd/Ctrl+B / I toggle marks; Enter continues a list, Enter on an empty item ends it; Backspace at item start lifts it to a paragraph.

**Checklists are scratch notes.** They are not tasks: no `doneAt`, no Stats, no Done log. A tick rewrites the comment string, so two devices ticking different items concurrently lose one tick to last-writer-wins. That is accepted.

**Agenda preview.** The first non-empty line, rendered inline, plus an `n/m` pill when the comment has checklist items. The map keeps only the existing comment badge.

## Delivery Requirements

1. **Policy exception.** CLAUDE.md gains one narrowly worded exception next to `sw.js`: a single lazy-loaded vendor bundle for the comment editor, holding third-party code only. No application logic (tokenizer, schema mapping, autosave, merge) moves into it.
2. **Build and updates.** ProseMirror packages are pinned npm dependencies bundled with esbuild into one content-hashed file. `npm run release` runs `npm outdated` for the editor packages and stops if they are behind, so every release either bumps deliberately (tests plus editor checklist) or confirms currency. The release script builds the bundle, writes its content hash and SRI into `zenit-week.html`, and commits it; Vercel keeps installing with `--omit=dev` and never builds the editor.
3. **Licences.** All required packages are MIT (`prosemirror-model`, `-state`, `-view`, `-transform`, `-history`, `-keymap`, `-inputrules`, `-commands`, `-schema-list`, and their dependencies `orderedmap`, `rope-sequence`, `w3c-keyname`), compatible with the app's MIT licence. The bundle keeps every copyright and licence notice (esbuild legal comments preserved). The release script fails if any package in the bundle has a licence outside an allow-list (MIT, ISC, BSD-2/3-Clause, Apache-2.0).
4. **Loading.** The bundle is served from `/vendor/editor.<hash>.js` with `Cache-Control: public, max-age=31536000, immutable` in `vercel.json`. The page fetches it on first comment-panel open and also prefetches it once the app is idle after boot — same origin, with a deadline, gated by `isDefinitelyOffline()`, never on the startup path. The page references the exact hashed name with an SRI `integrity` hash written by the release script. CSP `script-src 'self'` already allows it; no new hash is needed.
5. **Offline.** `sw.js` precaches the bundle as a shell asset and deletes the previous hashed file on update. This stays within the worker's allowed concern (shell caching).
6. **Fallback.** If the bundle is missing, slow or throws, the panel opens today's plain textarea immediately. It upgrades to the rich editor only when the bundle is ready and the user has not started typing. A comment is never blocked.
7. **No-op round trip.** Opening and closing a comment without a real user edit must leave the stored string byte-identical — no escaping of `*` to `\*`, no bullet-style rewrite, no trimming. Only a real edit triggers a write, `touchNode`, and the undo snapshot.
8. **Security.** Pasted content goes through the ProseMirror schema only (allow-list); our tokenizer never accepts HTML. Link targets are limited to `http:`, `https:` and `mailto:` and open with `noopener noreferrer`. Our code keeps the no-`innerHTML` rule; vendor code is reviewed on each version bump.
9. **UI.** Styling uses the dialog vocabulary and theme tokens, including dark mode. Any toolbar or editor strings get EN and CS translations. Cmd/Ctrl+B and I are checked against the keydown handler for collisions.

## Key Assumptions to Validate
- [ ] ProseMirror handles Android Gboard / Samsung keyboard autocorrect and Czech diacritics without caret jumps — manual pass on a real Android phone before release
- [ ] Lazy load on first open feels instant on a normal link and the fallback is acceptable on EDGE — throttled test in DevTools
- [ ] The no-op round trip holds for every existing comment — vitest over a corpus of real comments (exported week data), asserting byte-identical output
- [ ] Undo grouping feels like Docs — Playwright in Chromium and WebKit, plus a manual iOS check of shake-to-undo
- [ ] The fixed grammar covers real use (checklists, links, emphasis) — review a few weeks of real comments after rollout

## MVP Scope

**In:**
- Tokenizer and DOM builder in the main file, with vitest coverage (grammar, round trip, link scheme allow-list)
- ProseMirror editor in the comment panel: the grammar above, input rules, Cmd/Ctrl+B/I, clickable checkboxes, links
- Editor-level undo/redo via `prosemirror-history`
- Agenda preview: first line plus `n/m` checklist pill
- Lazy loading, SRI, service-worker precache, textarea fallback
- Release-script checks: outdated editor packages, licence allow-list, bundle build and hash injection
- CLAUDE.md policy exception

**Out:** see Not Doing.

## Not Doing (and Why)
- **Storing HTML or JSON** — breaks the plain-string model, the validator, the merge, and readability on older clients.
- **`markdown-it` or any general Markdown parser** — most of the bundle weight, and it accepts HTML; our grammar is small enough to own.
- **Inlining ProseMirror** — +67 KB gzip, three times the 20 KB budget for inline code.
- **Hand-built editor** — fits the budget but carries the highest risk on phone keyboards; kept as a fallback plan only if the lazy file proves unworkable.
- **Checklists as real tasks** (stats, Done log, promote-to-child) — duplicates child activities and counters; comment checklists are scratch notes.
- **Nested lists, tables, images, code blocks** — not in the reported pain; each widens the grammar and the round-trip surface.
- **Rich preview on the map node** — the badge stays; the map is not the place for comment content.
- **Merging concurrent comment edits at character level** — last-writer-wins by `_ts` is accepted for notes of this size.

## Decisions (2026-09-29)
- **Fetching:** on panel open plus an idle prefetch after boot; same origin, deadline, offline-gated, never on the startup path. Accepted as compatible with the network policy.
- **Build:** `npm run release` builds, hashes and commits the bundle and injects the SRI hash; Vercel does not build it.
- **Serving:** `/vendor/editor.<hash>.js`, `immutable` one-year cache header.
- **Soft limit:** the 1000-character counter counts visible text only, not Markdown markers. It remains a soft limit with no effect on storage.

## Open Questions
- None blocking. Revisit the fetch decision if the idle prefetch shows up on slow-link profiles.

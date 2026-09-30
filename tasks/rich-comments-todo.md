# TODO — Rich Comments

Plan: `tasks/rich-comments-plan.md` · Idea: `docs/ideas/rich-comments.md` · Branch: `main`

Order: **S1 → S2 → Checkpoint 1**, then S4 → S5. S3 is independent and may run any time before S4. S6 and S7 follow Checkpoint 2 in either order. Check off only when AC + verification both pass.

---

## S1 — Vendor pipeline

- [x] T1.1 — Add pinned (exact-version) `prosemirror-model`, `-state`, `-view`, `-transform`, `-history`, `-keymap`, `-inputrules`, `-commands`, `-schema-list` and `esbuild` as devDependencies.
- [x] T1.2 — `vendor/editor-entry.js`: re-exports only — no application logic. Header comment states that rule.
- [x] T1.3 — `scripts/build-editor.mjs` (`npm run editor:build`): esbuild IIFE, minified, `--legal-comments=eof`; writes `vendor/editor.<contenthash>.js`; deletes the previous hashed file; writes the file name and SRI `sha384` into a marked constant in `zenit-week.html` in the same step.
- [x] T1.4 — Licence check in the build script: walk the bundled packages; fail on any licence outside MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0.
- [x] T1.5 — `vercel.json`: `/vendor/(.*)` gets `Cache-Control: public, max-age=31536000, immutable`.
- [x] T1.6 — Tests: filename hash matches content; SRI in the page matches the file; bundle contains the MIT notices; the licence check rejects a fake GPL entry.
- [x] T1.7 — `npm test` + `npm run validate` green.

**AC:** one command produces a hashed bundle with licence notices, and the page's constant names it with a matching SRI; a disallowed licence stops the build.
**Verify:** `npm run editor:build` twice with no change → identical file name; `npm test`.

---

## S2 — Lazy editor, plain text

- [x] T2.1 — Loader in `zenit-week.html`: `loadCommentEditor()` injects one `<script src integrity crossorigin>` for the hashed bundle; memoised promise; deadline; resolves to the ProseMirror namespace or rejects.
- [x] T2.2 — Minimal schema (doc → paragraphs → text) built by a function that takes the ProseMirror namespace as a parameter (testable in `tests/setup.js`).
- [x] T2.3 — `openCommentDialog()` (`:19478`): show the textarea at once; when the editor resolves and the textarea has no unsaved keystrokes, swap in the editor with the same text and caret at end. On load failure keep the textarea silently.
- [x] T2.4 — Autosave: editor changes feed the same `scheduleCommentAutosave()` / `persistCommentDraft()` (`:19507`) path; `planCommentWrite` dirty-check, one `takeSnapshot()` per session, `visibilitychange` flush and `closeCommentDialog()` (`:19539`) flush all unchanged in behaviour.
- [x] T2.5 — `prosemirror-history` + keymap: Cmd/Ctrl+Z, Cmd+Shift+Z, Ctrl+Y, and `beforeinput` `historyUndo` / `historyRedo`. Global app hotkeys stay suppressed while the editor has focus (`isTypingTarget()` `:17367` recognises the editor).
- [x] T2.6 — Editor styles from dialog tokens; light + dark; fills `#comment-body` like the textarea did.
- [x] T2.7 — Tests: plain text round trip is byte-identical (including `*`, `#`, blank lines, trailing spaces); no write when the text is unchanged; loader rejects → textarea path.
- [x] T2.8 — `npm test` + `npm run validate` + **`npm run csp`** green.
- [x] T2.9 — `sw.js` serves `/vendor/editor.<hash>.js` by refetching with `OWN_FETCH_HEADERS` — a `<script>` cannot send `ngrok-skip-browser-warning`, so behind the dev tunnel the interstitial failed SRI. S6 adds caching to this same route.

**AC:** the comment panel edits through ProseMirror with exactly today's behaviour (plain text, autosave, one app-undo step per session); in-editor undo/redo works from every entry point; a blocked or missing bundle leaves today's textarea fully working.
**Verify:** browser desktop Chrome + Safari; DevTools block `/vendor/*` → textarea still works; open and close a comment without typing → no `_ts` bump, no undo entry.

### ⛔ CHECKPOINT 1 — phone go/no-go on ProseMirror

- [x] Android (Gboard): autocorrect replacing words, swipe typing, Czech diacritics (`ěščřžýáíé`), keyboard undo key.
- [ ] iOS Safari: dictation, autocorrect, shake-to-undo, three-finger undo swipe.
- [ ] No caret jumps, no dropped or doubled characters in a 2-minute typing session on each.
- [x] Decision recorded here: continue with ProseMirror, or switch to the hand-built fallback.
  - 2026-09-29: **continue with ProseMirror.** Android passed on a real phone. iOS Safari not yet tested — carried to Checkpoint 2.

---

## S3 — Grammar, tokenizer, Agenda preview

- [x] T3.1 — `tokenizeComment(str)` — pure; blocks: paragraph, `#` heading, `- ` bullet, `- [ ] ` / `- [x] ` checkbox; inline: `**bold**`, `*italic*`, `[text](url)`, bare-URL autolink. Everything else literal. Every token keeps its source range.
- [x] T3.2 — `isSafeCommentUrl(url)` — only `http:`, `https:`, `mailto:`; unsafe links render as literal text.
- [x] T3.3 — `buildCommentInline(tokens)` — DOM via `createElement` + `textContent` only; links get `rel="noopener noreferrer"` and `target="_blank"`.
- [x] T3.4 — `commentVisibleLength(str)` — visible characters only; `updateCommentCounter()` (`:19470`) uses it.
- [x] T3.5 — Agenda row (`buildAgendaItem()` `:20146`, comment badge `:20284`): first non-empty line rendered inline, single-line ellipsis; `n/m` pill when checklist items exist. Reuses existing badge classes.
- [x] T3.6 — Tests: grammar table; unsafe schemes (`javascript:`, `data:`, `vbscript:`, mixed case, leading whitespace, entity tricks); corpus of real comments → tokens → re-serialized string is byte-identical; visible length; preview first line and pill count.
- [x] T3.7 — `npm test` + `npm run validate` + **`npm run csp`** green.

**AC:** Markdown comments show formatted first lines and checklist progress in the Agenda; no unsafe link ever becomes clickable; every existing comment round-trips unchanged.
**Verify:** browser Agenda, light + dark, EN + CS; a comment with `- [x] a` / `- [ ] b` shows `1/2`.

---

## S4 — Rich blocks

- [x] T4.1 — Schema gains heading (one level), bullet list, checkbox list; Markdown bridge = S3 tokenizer in, serializer out, both in the main file.
- [x] T4.2 — Checkbox node view: tap/click toggles as one editor transaction (one undo step); keyboard-accessible.
- [x] T4.3 — Input rules: `- ` → bullet, `[] ` and `- [ ] ` → checkbox, `# ` → heading.
- [x] T4.4 — Keymap: Enter continues a list item; Enter on an empty item ends the list; Backspace at item start lifts to paragraph.
- [x] T4.5 — Tests: doc ↔ Markdown for every block type; tick → serialized `[x]`; untouched rich comment round-trips byte-identical.
- [x] T4.6 — `npm test` + `npm run validate` + **`npm run csp`** green.

**AC:** a user can build a checklist by typing `[] ` and ticking items; undo reverses a tick; the stored string is plain Markdown readable on an old client.
**Verify:** browser desktop + Android + iOS; the Agenda pill updates after ticks.

---

## S5 — Rich inline

- [x] T5.1 — Marks: bold, italic, link. Cmd/Ctrl+B / I (check the keydown handler for collisions first).
- [x] T5.2 — Input rules: closing `**x**` → bold, `*x*` → italic; typed or pasted bare URL → link.
- [x] T5.3 — Link mark parse rule enforces `isSafeCommentUrl`; Cmd/Ctrl-click opens with `noopener`; resolve the phone "open link" affordance per the plan's Open Questions.
- [x] T5.4 — Paste: HTML passes only through the schema; unknown marks and nodes dropped; plain-text paste goes through the tokenizer.
- [x] T5.5 — i18n for any new strings (EN + CS).
- [x] T5.6 — Tests: marks round trip; unsafe link pasted as HTML becomes plain text; pasted `<script>` / `<img onerror>` produce no element.
- [x] T5.7 — `npm test` + `npm run validate` + **`npm run csp`** green.

**AC:** bold, italic and links work by shortcut and by typing Markdown; no pasted or synced content can create an unsafe link or element.
**Verify:** browser; paste from a web page and from Google Docs; dark mode.

### ⛔ CHECKPOINT 2 — editor feel review

- [x] Use for a day on desktop and phone.
- [x] Decide: phone formatting toolbar yes/no; phone link-open affordance.
  - 2026-09-30: **phone toolbar — yes** (added as S5b below). **Link open — keep the Open-link chip** under the caret.

---

## S5b — Phone formatting toolbar (from Checkpoint 2)

- [x] T5b.1 — `#comment-toolbar` above the editor: Bold, Italic, Heading, Bullet, Checkbox; built from `.agenda-action-btn`; hidden on fine-pointer (desktop) devices.
- [x] T5b.2 — Buttons keep caret and keyboard (`mousedown` prevented); marks toggle, block buttons switch the selected lines and switch back when already that type; `aria-pressed` mirrors the caret's state.
- [x] T5b.3 — EN + CS labels.
- [x] T5b.4 — Tests: block toggle on/off, multi-line selection, active-state report.
- [x] T5b.5 — `npm test` + `npm run validate` + **`npm run csp`** green.

---

## S6 — Offline + prefetch

- [ ] T6.1 — `sw.js`: precache the current hashed bundle (name passed from the page, not hard-coded in the worker); delete other `/vendor/editor.*` entries; bump `CACHE_NAME` only if needed.
- [ ] T6.2 — Idle prefetch after boot via `requestIdleCallback`, gated by `isDefinitelyOffline()` (`:4768`), slow connection and `saveData`; never on the startup path.
- [ ] T6.3 — Tests: prefetch skipped when offline / `saveData`; worker cleanup keeps only the current bundle.
- [ ] T6.4 — `npm test` + `npm run validate` + **`npm run csp`** green.

**AC:** after one online visit, the rich editor opens offline; the cache holds exactly one editor bundle.
**Verify:** DevTools offline → open comment → rich editor; Application → Cache Storage shows one bundle.

---

## S7 — Release gate + docs

- [ ] T7.1 — `scripts/release.mjs`: before the version commit, run `npm outdated` for the editor packages (fail if behind), `npm run editor:build`, the licence check, and `npm test`; any failure aborts with no commit.
- [ ] T7.2 — CLAUDE.md: narrow single-file exception for `vendor/editor.<hash>.js` next to the `sw.js` exception; data model note that `comments` is Markdown in the fixed grammar.
- [ ] T7.3 — Help panel: comments feature line mentions formatting (EN + CS).
- [ ] T7.4 — CHANGELOG entry; update `docs/ideas/rich-comments.md` status.
- [ ] T7.5 — `npm test` + `npm run validate` + **`npm run csp`** green.

**AC:** a release cannot ship an outdated or disallowed-licence editor bundle; the policy exception is written down.
**Verify:** dry-run the release checks with an intentionally outdated package → abort, no commit.

### ⛔ CHECKPOINT 3 — ship

- [ ] All AC met; phone pass repeated on the final build.
- [ ] Review with human before the release.

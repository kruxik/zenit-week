# Plan — Rich Comments

Source idea: [`docs/ideas/rich-comments.md`](../docs/ideas/rich-comments.md)
Task list: `tasks/rich-comments-todo.md` · Branch: `main` (no feature branch unless asked) · App file: `zenit-week.html` · Vendor file: `vendor/editor.<hash>.js`

## Overview

Comments become Docs-like rich text — headings, bullets, checkboxes, bold, italic, links — while the stored value stays one plain Markdown string on `node.comments`. Editing runs on ProseMirror, lazy-loaded as a separate same-origin vendor bundle, with `prosemirror-history` owning in-editor undo/redo. Our own tokenizer in the main file renders the Agenda preview, powers the Markdown bridge, and keeps the plain textarea as a fallback.

## Principles

- **Vertical slices.** Each slice ends with something a user or a test can exercise end to end.
- **Fail fast.** The riskiest unknown — ProseMirror on phone keyboards (Android autocorrect, Czech diacritics, iOS undo gestures) — is exercised in S2 and gated by a checkpoint before any rich formatting work.
- **Storage never changes.** `node.comments` stays a plain string. `mergeWeekData`, the validator and the Drive format are not touched by any slice.
- **Only vendor code leaves the single file.** The bundle entry only re-exports ProseMirror. Schema, Markdown bridge, autosave and loader all live in `zenit-week.html`.
- **Each slice ships with** code + EN/CS strings (where user-visible) + vitest coverage. `npm test`, `npm run validate` and `npm run csp` green before commit. One commit per slice, asked for first.

## Architecture Decisions

- **ProseMirror over Lexical or a hand-built editor.** 67 KB gzip for everything we need vs 125 KB for Lexical; a hand-built editor fits the budget but carries the phone-keyboard risk. Measured 2026-09-29.
- **Lazy separate file, not inlined.** Inlining adds +22% to the app's 298 KB gzip. The file is loaded on first comment-panel open and prefetched when idle after boot.
- **Bundle built and committed by a script, not on Vercel.** Vercel installs with `--omit=dev`; a committed bundle means the reviewed bytes are the deployed bytes.
- **Our tokenizer, not `markdown-it`.** Smaller, HTML-free, and the only way the Agenda preview renders without waiting for the bundle.
- **Dependency injection for tests.** The schema and Markdown bridge in the app script take the ProseMirror namespace as a parameter, so vitest can pass the real packages from `node_modules` into the existing `vm`-based `tests/setup.js` harness. No jsdom migration.
- **Service worker gains one asset.** Precaching the bundle is shell caching — within `sw.js`'s allowed concern. No application logic moves into the worker.

## Dependency Graph

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│ S1 Vendor pipeline       │        │ S3 Grammar + tokenizer       │
│  build, hash, SRI,       │        │  + Agenda preview + n/m pill │
│  licences, /vendor/ hdr  │        │  + visible-text counter      │
└────────────┬─────────────┘        └──────────────┬───────────────┘
             ▼                                     │  (independent of S1/S2 —
┌──────────────────────────┐                       │   can run in parallel)
│ S2 Lazy editor, plain    │                       │
│  text: loader, fallback, │                       │
│  autosave, undo/redo     │                       │
└────────────┬─────────────┘                       │
             ▼                                     │
     ⛔ CHECKPOINT 1 — phone go/no-go               │
             │                                     │
             └──────────────────┬──────────────────┘
                                ▼
               ┌──────────────────────────────┐
               │ S4 Rich blocks: heading,     │
               │  bullet, checkbox, rules     │
               └──────────────┬───────────────┘
                              ▼
               ┌──────────────────────────────┐
               │ S5 Rich inline: bold, italic,│
               │  links, autolink, paste      │
               └──────────────┬───────────────┘
                              ▼
                  ⛔ CHECKPOINT 2 — editor feel
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
┌──────────────────────────┐     ┌──────────────────────────────┐
│ S6 Offline + prefetch    │     │ S7 Release gate + docs       │
│  sw.js precache/cleanup, │     │  release.mjs checks, CLAUDE  │
│  idle prefetch           │     │  exception, Help, CHANGELOG  │
└────────────┬─────────────┘     └──────────────┬───────────────┘
             └────────────────┬─────────────────┘
                              ▼
                  ⛔ CHECKPOINT 3 — ship
```

## Slices

| Slice | Delivers | Size | Risk |
|---|---|---|---|
| S1 | `npm run editor:build` produces a hashed, licence-checked bundle served from `/vendor/` | M | Low |
| S2 | Comment panel runs on ProseMirror (plain paragraphs), falls back to textarea, keeps autosave and undo | M | **High** — phone input |
| S3 | Markdown comments render in the Agenda preview with a checklist `n/m` pill | M | Medium — round-trip fidelity |
| S4 | Headings, bullets and tickable checkboxes in the editor, Docs-style input rules | M | Medium |
| S5 | Bold, italic, safe links, autolinks and schema-filtered paste | M | Medium — security |
| S6 | Editor works offline and opens instantly after the first visit | S | Low |
| S7 | Every release checks editor currency and licences; policy and docs updated | S | Low |

## Risk Notes per Slice

- **S1.** Keep esbuild's legal comments (`--legal-comments=eof`) or the MIT notices are lost. The hash in the filename and the SRI hash in the page must come from the same bytes — write both in one step.
- **S2.** Autosave must keep its current contract: one `takeSnapshot()` per dialog session, `planCommentWrite` dirty-check, write on `visibilitychange`. The upgrade from fallback textarea to editor must never happen while the user is typing, or characters are lost. After any inline-script edit, run `npm run csp` — a stale hash presents as a completely dead app.
- **S3.** The round-trip rule is the regression cliff: an untouched comment must serialize back byte-identical. Test against a corpus of real existing comments, including ones with literal `*`, `_`, `#`, `[`, leading spaces and blank lines.
- **S4.** A checkbox tick is an editor transaction (one undo step), not a direct string write. Enter on an empty item ends the list; Backspace at item start lifts to a paragraph.
- **S5.** Link scheme allow-list (`http:`, `https:`, `mailto:`) applies in three places: the tokenizer, the schema's link mark parse rule, and the click handler. Paste must go through the schema — never through our tokenizer as HTML.
- **S6.** The worker must delete the previous hashed bundle when a new one is precached, or the cache grows every release. Prefetch gated by `isDefinitelyOffline()`, slow connection and `saveData`, exactly like the quiet refresh.
- **S7.** `scripts/release.mjs` currently commits and tags only; the new checks must run before the version commit so a failing check leaves no half-made release.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ProseMirror misbehaves with Android autocorrect or Czech input | High | S2 ships plain-text-only and is gated by a real-phone checkpoint before rich work; hand-built editor is the documented fallback |
| Round trip rewrites untouched comments (escapes, bullet style, trimming) | High | Write only on real edits; corpus round-trip test in S3; `planCommentWrite` dirty-check stays |
| Stale CSP hash after inline-script edit kills the app | High | `npm run csp` in every slice's verification |
| XSS through a `javascript:` link from Drive data | High | Scheme allow-list in tokenizer, schema and click handler; tests for each |
| Bundle missing offline on a fresh install | Medium | Textarea fallback in S2; precache in S6 |
| Vendor update introduces a non-permissive licence | Medium | Licence allow-list check in S1, enforced in release in S7 |
| Cache growth from old hashed bundles | Low | Worker cleanup in S6 |

## Open Questions

- **Phone formatting without shortcuts.** Input rules (`**`, `- `, `[] `, `# `) cover formatting on phone. Is that enough, or do phones need a small formatting toolbar? Recommendation: decide at Checkpoint 2 after using S4–S5 on the phone.
- **Opening a link while editing.** Desktop: Cmd/Ctrl-click. Phone: a tap places the caret. Recommendation: a small "open" chip appears beside the caret when it sits inside a link; confirm at Checkpoint 2.

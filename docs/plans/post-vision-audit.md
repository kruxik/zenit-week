# Post-Vision audit - fix checklist

> Source: six read-only audits run on 2026-11-12, right after `vision-canvas` merged into `main` (943a4d6).
> Each row has a stable ID. Work through them by ID; set Status and the closing commit when done.
> Delete this file once every row is closed.

Status: ⬜ open · ✅ done · ⏸️ deferred (needs a decision or a spec) · ❌ won't fix

Severity: 🔴 severe · 🟠 medium · 🟡 minor

---

## README (Documentation)

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| README-1 | 🔴 | ✅ | README.md:56 | Views row lists Mindmap / Agenda / Stats only, no Vision `V`. | Add Vision `V` to the views row. | a163e5a |
| README-2 | 🔴 | ✅ | README.md:62 | "Cycle view level" shown on `V`; code binds it to `W`, and `V` opens the Vision. | Change to `W`. | a163e5a |
| README-3 | 🔴 | ✅ | README.md (whole) | Vision is not mentioned anywhere: no feature bullet, no `1`-`4` horizon filter, Let go / Take back, collapse, focus. | Add a feature bullet, the horizon filter row and a Vision hotkeys section. | a163e5a |

## DOCS (other documentation)

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| DOCS-1 | 🟠 | ✅ | CLAUDE.md:93 | "one of the three top-level views (`M` / `A` / `S`)" - there are four. | Four views, name `V`. | f8e54c9 |
| DOCS-2 | 🟠 | ✅ | CLAUDE.md data model | `horizon`, `collapsed` and the separate vision record (IDB `misc` key `vision`, `weekData` holds it while the Vision is in view) are undocumented; a future agent can corrupt the Vision. | Add a short "Vision record" paragraph with a spec link. | f8e54c9 |
| DOCS-3 | 🟠 | ✅ | mcp/manifest.json:89, 93 | `transfer_unfinished` / `transfer_reusable` descriptions are truncated ("previous week\\."), likely the apostrophe in "week's". | Fix the generator; add a test that manifest descriptions equal server.js. | f8e54c9 |
| DOCS-4 | 🟠 | ✅ | docs/specs/vision-canvas.md:3-5 | Header still names the branch and worktree; no Status line. | "Status: Implemented (merged 943a4d6)". | |
| DOCS-5 | 🟠 | ✅ | docs/specs/vision-canvas.md:351, 355 | AC 2 requires the removed first-open hint; AC 6 says horizon is an annotation (it is a badge icon). | Update both criteria. | |
| DOCS-6 | 🟡 | ✅ | docs/specs/vision-canvas.md:239, 245 | "One resource and one tool" - four tools shipped; cites bridge §8.3 instead of §8.4. | Say four tools, cite §8.4. | |
| DOCS-7 | 🟡 | ✅ | docs/specs/vision-canvas.md:90, 94, 276 | Stale call-site counts and line numbers. | Drop them. | |
| DOCS-8 | 🟡 | ✅ | mcp/server.js:250, mcp/manifest.json:97 | `add_branch` says "the week in view"; it acts on the record in view. | "record in view". | f8e54c9 |
| DOCS-9 | 🟡 | ✅ | docs/specs/agent-bridge.md:3 | Status still "Implemented on branch `agent-bridge`". | Say merged; note the Vision extensions. | |
| DOCS-10 | 🟡 | ⬜ | SPEC.md | Old stats spec, no Vision. | Decide whether SPEC.md should cover the product; otherwise leave. | |

## UI (English UI text and Help)

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| UI-1 | 🟠 | ✅ | zenit-week.html `help.vision.focus` (en 13089, cs 13619) | Still describes the removed right-hand reading pane. | Delete the sentence (en + cs). | 77c1a77 |
| UI-2 | 🟠 | ✅ | same key | Says focus "dims the rest" and "Esc or a click on the centre ends it"; it also collapses the others, and F, the logo and the Focus cell end it. | Reword (en + cs). | 77c1a77 |
| UI-3 | 🟠 | ✅ | `help.vision.horizon` (en 13087, cs 13617) | "Shown after the name" - it is a badge icon; the `1`-`4` filter is not mentioned. | Reword (en + cs). | 77c1a77 |
| UI-4 | 🟠 | ✅ | Help 5516-5565 | Week-only hotkeys (D, U, R, N, B, days, week nav, Clear week) carry no "not on the Vision" note. | Mark rows or add one Vision line. | caf8081 |
| UI-5 | 🟡 | ✅ | `tips.views` (12830, cs 13360) | "Three views" but four are listed. | "Four views ...". | 87b96bd |
| UI-6 | 🟡 | ✅ | `tips.levels` (12829), 5495, 13026 | "Pebbles adds sub-tasks" is wrong on the Vision (Pebbles adds intentions). | Neutral wording. | 87b96bd |
| UI-7 | 🟡 | ✅ | `help.featureBackupBody` (13048) | Backup also includes the Vision. | Mention the Vision. | 87b96bd |
| UI-8 | 🟡 | ✅ | Help Key features 5490-5509 | No Vision entry. | Add one. | 87b96bd |
| UI-9 | 🟡 | ✅ | `help.navFitDesc` (13095, 5586) | Logo also resets filters, level and focus, not only fits. | Reword. | 87b96bd |
| UI-10 | 🟡 | ✅ | `toast.letGo` / `toast.takenBack` (12846, 12848); `help.navTitle` (13123) | Mixed grammar; "Canvas Navigation" is the only "canvas" in Help. | Align wording; "Map navigation". | 87b96bd |
| UI-11 | 🟡 | ✅ | `help.filterHorizon` (5557) | Does not say 4 = No horizon / the order. | Add the order. | 87b96bd |

## I18N (Czech translations)

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| I18N-1 | 🟠 | ✅ | cs `help.vision.*` | Vykání ("chcete", "vzdali") in an app that uses tykání. | Rewrite in tykání. | 77c1a77 |
| I18N-2 | 🟠 | ✅ | cs `filter.focusEnd`, `toast.controlsHidden`, `tips.dayFilter` | Vykání. | Tykání. | caf8081 |
| I18N-3 | 🟡 | ✅ | cs `menu.focusBranch` vs `filter.focusShort` / `help.vision.focus` | "Zaměřit" vs "Fokus" for one concept. | One term. | e4e0e75 |
| I18N-4 | 🟡 | ✅ | `nav.prev`, `nav.next`, `weekbar.today`, `stats.trendWeek`, `filter.showing`, `filter.emptyDay`, `filter.emptyDayShort`, `stats.noUnplanned`, `help.fab` | Dead keys (last two referenced only by tests/i18n.test.js). | Remove from en + cs and the test. | e4e0e75 |
| I18N-5 | 🟡 | ✅ | cs `bridge.toast.*` | Masculine past tense ("Přidal", "Vrátil"). | Neutral form. | e4e0e75 |
| I18N-6 | 🟡 | ⬜ | cs terminology | Mixed "aktivita" / "úkol" (pre-existing). | Optional cleanup. | |

## ONB (Tips and Playground)

Coachmarks in HINTS order: 1 done, 2 unplanned, 3 counter, 4 days, 5 priority, 6 inbox, 7 hover-keys, 8 undo, 9 views, 10 levels, 11 root, 12 signin, 13 weeknav, 14 quickadd, 15 dayfilter.

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| ONB-1 | 🟠 | ⏸️ | `playgroundSeedNodes` (30871), assets/playground-seed.json | No Vision example content; a new user meets an empty Vision. Documented deferral. | Needs a spec (with ONB-2). | |
| ONB-2 | 🟠 | ⏸️ | `clearExampleTasks` (30964), `hasDemoActivityNodes` (30948) | Clear / nudge act on `weekData` only; `validateAndRepairVision` strips `_demo`. | Design together with ONB-1. | |
| ONB-3 | 🟠 | ⏸️ | HINTS | No Vision first-open coachmark. | Needs a spec (with ONB-4). | |
| ONB-4 | 🟠 | ⏸️ | HINTS #15 (31208) | Day-filter tip is hidden on the Vision; `#horizon-filter-btn` has no tip. | Add a horizon hint. | |
| ONB-5 | 🟡 | ⬜ | Hints #5, #7, #11 | Say "task" when shown on the Vision. | Vision wording when `isVisionInView()`. | |
| ONB-6 | 🟡 | ⏸️ | Hints #13, #14 | Week-nav tip unreachable on the Vision; Quick add on the Vision undecided. | Decide Quick add on the Vision. | |
| ONB-7 | 🟡 | ✅ | docs/specs/onboarding-part-b-coachmarks.md | Status Draft, 4 hints vs 15 in code, stale §7 sync section. | Rewrite to match code. | |
| ONB-8 | 🟡 | ✅ | docs/specs/onboarding-part-a-playground.md:76 | Nudge threshold 3 in spec, 7 in code. | Update to 7. | |

## WEB (Landing pages)

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| WEB-1 | 🟠 | ⬜ | index.html:55-60, cs/index.html:63-68 | JSON-LD featureList has no Vision. | Add in both. | |
| WEB-2 | 🟠 | ⬜ | index.html:1030-1146, cs equivalent | No Vision card or section. | Add, EN + CS together. | |
| WEB-3 | 🟠 | ⬜ | assets/hero.webp, hero-cs.webp | Predate the Vision. | Regenerate via `npm run screenshots` if Vision should show. | |
| WEB-4 | 🟡 | ⬜ | index.html:1134, cs/index.html:1134 | "Type 10x and you get a counter" - it is ticks now. | Reword. | |
| WEB-5 | 🟡 | ⬜ | sitemap.xml | No `<lastmod>`. | Add or skip on purpose. | |

## GH (GitHub)

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| GH-1 | 🟠 | ⬜ | .github/workflows | No CI on push / PR; tests run only on release tags. | Add `ci.yml`: `npm ci && npm test && npm run validate`. | |
| GH-2 | 🟠 | ⬜ | deploy-production.yml:22, package.json, mcp/package.json:39 | Node 26 in deploy, `>=20` for mcp, none for root. | Add root `engines`; test mcp on 20. | |
| GH-3 | 🟡 | ⬜ | .github/ISSUE_TEMPLATE/bug_report.md | "Open zenit-week.html"; no view / sync / AI / language / mobile fields. | Update the template. | |
| GH-4 | 🟡 | ⬜ | .github/PULL_REQUEST_TEMPLATE.md:18 | Checklist contradicts the real rules (two allowed exceptions, csp, tests). | Align with CLAUDE.md. | |
| GH-5 | 🟡 | ⬜ | .github/FUNDING.yml | Only a commented placeholder. | Fill in or delete. | |
| GH-6 | 🟡 | ⬜ | package.json:4, 10-19 | Description / keywords miss MCP and the Vision. | Align with the repo description. | |

## LEGAL

| ID | Sev | Status | Where | Finding | Fix | Commit |
|---|---|---|---|---|---|---|
| LEGAL-1 | 🟠 | ⬜ | privacy.html §2.1-2.3, terms.html §3 | Vision data (IDB `vision`, Drive `zenit-week-vision.json`) and agent access to it (`zenit://vision`, `open_vision`) not disclosed. | Add the Vision; bump the date. | |
| LEGAL-2 | 🟠 | ⬜ | privacy.html §3 (~112) | Claims the app loads `apis.google.com/js/api.js`; it does not. | Correct against the CSP. | |
| LEGAL-3 | 🟠 | ⬜ | privacy.html:184-190, 94 | "Vercel Edge Function"; it is a serverless function. | "serverless function". | |
| LEGAL-4 | 🟠 | ⬜ | privacy.html:76 | Points to §7 for the token function; it is §3/§4. | Fix the reference. | |
| LEGAL-5 | 🟠 | ⬜ | cs/ | No Czech privacy / terms; CS landing links English pages. | Add CS versions or state English is authoritative. | |
| LEGAL-6 | 🟡 | ⬜ | privacy.html, terms.html | "Last updated: 8 November 2026" predates the Vision. | Update with LEGAL-1. | |
| LEGAL-7 | 🟡 | ⬜ | terms.html §1, §4 | Missing full stop in §4; awkward "operated by ..., the Czech Republic" in §1. | Fix wording. | |
| LEGAL-8 | 🟡 | ⬜ | THIRD_PARTY_NOTICES.md | MCP deps (`@modelcontextprotocol/sdk`, `ws`, `zod`) not credited. | Add them or ship notices in mcp/. | |

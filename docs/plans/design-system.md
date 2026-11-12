# Design system hardening - checklist

Goal: make "a new UI element did not reuse its sibling component" structurally hard, enforced by tests instead of remembered rules.

Trigger (2026-11-12): the new Settings "Start view" select rendered with the browser default look, because Settings selects are skinned one by one by ID (`#lang-select, #theme-select, #bridge-guide-app`) and the new ID was not added to that list. Per-component prose rules in CLAUDE.md (buttons, dialogs) and in agent memory did not prevent it; the em dash rule holds because `tests/no-em-dash.test.js` fails.

Source: an architecture review of `zenit-week.html` (read-only, counts from parsing the source, not verified in a browser). Line numbers were taken on commit `af4dc18` and will drift: re-locate by selector or function name, never trust a line number blindly.

Ground rules for every phase:
- Single File Policy stays. Everything lives in `zenit-week.html`.
- Visual parity: every phase that touches CSS is checked in the browser, light and dark, before and after (see CLAUDE.md "Chrome testing token budget" and the local browser testing notes).
- `npm test`, `npm run validate`, and `npm run csp` after any inline-script edit.
- One commit per checklist item or tightly related group; ask before committing.
- Baseline lists in the guard test may only shrink. Never add an entry to make a test pass.

## Findings (state at af4dc18)

| # | Block | Shared today | Problem |
|---|---|---|---|
| 1 | Button | `.agenda-action-btn` (23 in markup, 8 of 13 JS-created) | 5 ID-skinned with no class: `#week-picker-label`, `#account-btn`, `#fab-add`, `#perf-probe-arm`, `#perf-probe-last`. About 11 button-ish classes (`ctx-item`, `agenda-tab`, `undo-redo-btn`, `view-toggle-btn`, `dp-day`, `wp-week-row`, `wp-today-item`, `qab-recent-branch`, ...) |
| 2 | Select | `.dialog-field`, used by 2 of 6 | 4 Settings selects skinned by an ID list (`#lang-select, #theme-select, #start-view-select, #bridge-guide-app`), the only rule using `--bg-input` |
| 3 | Text/number input | `.dialog-field`, used by 3 of 7 | `#cp-hex` and `#bp-input` are near-duplicate "bare input in a framed row" rules |
| 4 | Textarea | none | `#comment-textarea`, `#inline-input` ID-skinned |
| 5 | Switch | `.theme-toggle` + `.theme-toggle-row` | One component, misleading name, markup hand-copied 3 times |
| 6 | Dialog | `.dialog-shell` vocabulary, 9 users | `#week-picker-fold` has `role="dialog"` but redeclares its own glass surface |
| 7 | Panel | `.app-panel*`, 4 users | `.app-panel-close` is a second close X and a `div`, not a button, next to 12 `.help-close-btn` buttons |
| 8 | Menu | none | `#context-menu` and `#day-filter-menu` declare the same surface twice |
| 9 | Rows | `buildAgendaItem`, `.settings-row` | Settings "label + control" sections hand-written 14 times |
| 10 | Chips | `.qab-pill`, `buildBranchPill` | Builder bypassed twice (stats filter chips built by hand) |
| 11 | Icons | `iconSvg()` | Good |

Totals: 80 controls in markup (65 button, 7 input, 6 select, 2 textarea); 15 carry no class; 20 control IDs receive skin properties from an ID selector. 150 `createElement` calls, no button/field/switch/settings-row builder. 32 JS `.style` writes of skin properties, 77 inline `style=` attributes (mostly Help legend dots).

Tokens: colour is 322 of 326 declarations via variables (36 literal colours left in 23 rules: hue slider, dark scrollbars, dev badge, week picker open row, `.dp-day.selected`, `.ratio-segment`). Not tokenised at all: border-radius (80 declarations, 16 distinct values), font-size (98, 17 distinct, including 12.5px five times), z-index (34, 23 distinct, up to 9001). Spacing tokens judged low value: skip.

## Phase 1 - close the incident class

- [ ] **R1 Guard test** `tests/design-system.test.js`, modelled on `tests/hidden-attribute.test.js` (stylesheet extraction) and `tests/no-em-dash.test.js`. Each check has a frozen baseline in the test file plus an assertion that every baseline entry still exists in the source (so fixing an offender forces removing it, and adding one fails). Key baselines on selectors and IDs, never line numbers; failure messages name the catalogue component to use. Checks:
  - [ ] 1. Every `<button>`, `<select>`, `<input>` (except file, range, hidden) and `<textarea>` in markup carries a catalogue class. Baseline: today's 15 classless controls.
  - [ ] 2. No CSS rule whose final compound selector is a form-control ID sets skin properties (border, background, color, border-radius, font-size, font-weight, padding, box-shadow). Layout (width, flex, margin, display) stays allowed. Baseline: today's 20 IDs. This alone would have failed on `#start-view-select`.
  - [ ] 3. A `className` assigned to an element from `createElement('button' | 'input' | 'select' | 'textarea')` within the next few lines starts with a catalogue class. Baseline: `dp-day`, `wp-week-row`, `qab-recent-branch`, `ctx-item`, `agenda-tab`.
  - [ ] 4. Every `role="dialog"` element carries `dialog-shell` and contains a `.dialog-header`. Baseline: `week-picker-fold`.
  - [ ] 5. Outside `:root` / `[data-theme]` token blocks, no hex or `rgb()` literal in a declaration. Baseline: the 23 rules, keyed by selector.
  - [ ] 6. The set of class names matching `-btn`, `-toggle`, `-field`, `-select`, `-input`, `-close` equals a frozen set; a new one fails with "reuse a catalogue component or add it to the catalogue".
  - [ ] 7. (Switched on in Phase 5.) `border-radius`, `font-size`, `z-index` values are `var(...)`, `50%`, `0` or `inherit`, with a count ceiling that may only go down.
- [ ] **R2 One field class for Settings.** Delete the ID list rule; give the 4 Settings selects the shared field class. Decide whether Settings fields should look exactly like `.dialog-field`; if a difference is intended, express it once (modifier or `.settings-section` descendant rule on the class), never per ID. Verify in the browser. Shrinks R1.1/R1.2 baselines by 4.

## Phase 2 - guidance that generalizes

- [ ] **CLAUDE.md "UI components: sibling first"** section, replacing the per-incident vocabulary sentences (keep the `showAppConfirm` rule). Draft:

  > **UI components: sibling first.** Before adding any control, find the nearest existing sibling of the same kind in the same container and copy its classes and structure exactly. If no catalogue entry fits, stop and ask; do not invent one.
  > - Skin lives on classes, never on IDs. An ID may set layout only (width, flex, margin, display).
  > - Every button, select, input, textarea and switch carries a catalogue class. Colours, radii, font sizes and z-index come from `:root` variables.
  > - `tests/design-system.test.js` enforces all of this. Its baseline lists may only shrink; never add an entry to make a test pass.
  >
  > | # | I need | Use |
  > |---|---|---|
  > | 1 | Button | `.btn` (+ `.commit`, `.danger`), `uiButton()` |
  > | 2 | Icon-only / close | `.icon-btn` |
  > | 3 | Select, text or number field | `.field`, `uiSelect()` |
  > | 4 | On/off setting | `.switch` in `.switch-row`, `uiSwitch()` |
  > | 5 | Settings entry | `settingsRow()` inside `.settings-section` |
  > | 6 | Tabs | `.tab` |
  > | 7 | Dialog | `.dialog-shell/-header/-title/-body/-actions`; confirm via `showAppConfirm` |
  > | 8 | Side panel | `.app-panel*` |
  > | 9 | Popup menu | `.menu` + `.ctx-item` |
  > | 10 | Chip | `.btn.qab-pill`, `buildBranchPill()` |
  > | 11 | Icon | `iconSvg(name)` |

  Until the Phase 4 renames land, the table uses today's names (`.agenda-action-btn`, `.help-close-btn`, `.dialog-field`, `.theme-toggle`, `.agenda-tab`); update it in the same commit as each rename.
- [ ] **R7 In-file catalogue comment** at the top of the stylesheet section holding the components: each component, its class, its builder. R1 asserts every catalogue class named there exists in the CSS and vice versa.
- [ ] **Hook** (needs the owner's explicit approval at the time): a Claude Code PostToolUse hook in `.claude/settings.json` that runs only `tests/design-system.test.js` after an edit to `zenit-week.html`, so a violation is reported within seconds.
- [ ] Replace the narrow memory notes (reuse buttons, button match) with one general "sibling first, guard test enforces" note.

## Phase 3 - merge twins, add builders

- [ ] **R6** One `.menu` surface for `#context-menu` and `#day-filter-menu`.
- [ ] **R6** `.app-panel-close` becomes the shared icon button (a real `<button>`).
- [ ] **R6** `#cp-hex` and `#bp-input` share one "bare field" modifier.
- [ ] **R6** `#week-picker-fold` wears `.dialog-shell`.
- [ ] **R5** Builders next to `iconSvg` / `buildEmptyState`: `uiButton({ label, icon, variant, onClick })`, `uiSwitch(...)`, `uiSelect(...)`, `settingsRow({ labelKey, control })`.
- [ ] **R5** Route the 8 hand-built JS button sites through `uiButton`, and the 2 stats filter chips through `buildBranchPill`.
- [ ] **R5** Guard: outside the builder block, the count of `createElement('button' | 'select' | 'input')` has a ceiling that may only shrink.
- [ ] Shrink R1 baselines 1-4 toward empty as offenders are fixed.

## Phase 4 - role names (one name per commit; tests reference them)

- [ ] `.agenda-action-btn` to `.btn`
- [ ] `.theme-toggle*` to `.switch*`
- [ ] `.agenda-tab` to `.tab`
- [ ] `.help-close-btn` to `.icon-btn`
- [ ] `.dialog-field` to `.field`
- [ ] Update the CLAUDE.md table, the catalogue comment and R1.6's frozen set with each rename.

## Phase 5 - tokens

- [ ] Add `--radius-sm/md/lg/pill`, `--font-xs..xl`, `--z-*` to `:root`.
- [ ] Collapse 16 radii to 4-5 and 17 font sizes to about 7; visual review where 5/6/7/9px merge.
- [ ] Move z-index values onto `--z-*` layers.
- [ ] Switch on R1.7.
- [ ] Clear the 23 literal-colour rules last; shrink the R1.5 baseline to empty.

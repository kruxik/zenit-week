# TODO — Center Node Reboot: Identity In, Chrome Out

Plan: `tasks/center-node-reboot-plan.md` · Idea: `docs/ideas/center-node-reboot.md`
Order: **S1 → S2a → S2b → S3 → S5**. S4 (chip) is independent and may land any time
after S1. Check off only when AC + verification pass.

## S1 — Pure helpers ✅
- [x] T1.1 — `firstNameFrom(displayName, email)` + `centerDisplayName()`: first token of
      Drive `displayName` → email local-part → `t('center.you')`; clamp 16 chars with `…`.
      New `googleUserName` module var, set in `showSignedInAvatar`, cleared on sign-out.
- [x] T1.2 — i18n EN+CS: `center.you` (`You` / `Ty`).
- [x] T1.3 — `roundedRectPathD(w, h, rx)` → `{ d, perimeter }`, origin top-center, clockwise.
- [x] T1.4 — `formatWeekParts()` is now the source of truth (S2a needs two spans);
      `formatWeekLabel()` joins it to one line.
- [x] T1.5 — Exported from `tests/setup.js` + `_state.setGoogleUser()`;
      `tests/center-node.test.js` — 21 cases.
- [x] T1.6 — `npm test` 838 passed, `npm run validate` clean.
- [x] **C1 checkpoint** — app visually unchanged; `npm run csp` re-run (app-script hash).

### S1 deviations from the plan
- **AD5 softened.** `formatWeekLabel(year, week, multiline = false)` keeps a transitional
  `multiline` flag instead of dropping `\n` outright. Dropping it in S1 would have widened
  the root node to ~426px for one commit and shoved the branches sideways — a real, if
  temporary, regression. The two center call sites pass `true`; **delete the flag with
  them in T2.13**.
- **New fact for S2b:** the root label now depends on sign-in state, so sign-in and
  sign-out must trigger a re-render for the name to change. Verify whether the existing
  `syncColorsFromDrive` → `applyBranchColor` → `render()` path already covers sign-in,
  and whether sign-out re-renders at all.

## S2a — `#week-bar` ✅
- [x] T2.1 — Markup inside `#canvas-container`: `‹` · label · `⋯` · `›`. New `icon-dots`
      symbol; buttons reuse `.undo-redo-btn` unchanged.
- [x] T2.2 — CSS at `top:68px`, styled as a peer of the other button bars; date range
      hidden at ≤360px.
- [x] T2.3 — i18n EN+CS: `weekbar.today`, `weekbar.actions`; `nav.prev`/`nav.next` reused.
- [x] T2.4 — Arrows → `loadAndRender(offsetWeek(±1))`; `today-direction` accent on the
      arrow leading back to the present.
- [x] T2.5 — Label → `loadAndRender(todayWeekKey())`; `off-current` accent tint.
- [x] T2.6 — `⋯` → `showContextMenu('center')` anchored to its own rect.
- [x] T2.7 — `updateWeekBar()` from `loadAndRender`, `hashchange`, `applyTranslations()`.
- [x] T2.8 — `npm test` 838 passed, `npm run validate` clean.

### S2a verified in a real browser (headless Playwright, measured not eyeballed)
| Check | Result |
|---|---|
| Fit at 1280 / 390 / 360 / 320, EN + CS | fits at every width; 305→191px as the range drops |
| Range hidden ≤360, full wording kept in aria | `aria="Week 34 (Aug 17 - Aug 23)"` at 320px |
| Arrow titles name the target week | `Previous · W33` / `Předchozí · T33` |
| Accents | on current week: none; +1 week: prev lit; −1: next lit |
| `⋯` menu | opens below the bar, `ctx-current-week` shown when off-current |
| Label → today | returns to W34 and clears the URL hash |
| Drag on the bar | map does not pan |
| Agenda view | mobile: canvas hidden with the bar; desktop: behind the panel, `elementFromPoint` hits the panel |

### S2a additions beyond the plan
- `#week-bar` swallows its own `pointerdown`, matching `#day-filter-chip` and
  `#view-level-bar`. A guard inside the pan handler would also have kept
  document-level dismissals alive, but two mechanisms for one problem is worse than
  the precedent's small cost.
- Arrow buttons get `font-size: 22px` — `.icon` is `1em`, and the caret glyphs carry
  so much padding inside their viewBox that the inherited 16px read as decoration.
- `icon-dots` symbol added (three circles, Tabler style) for the `⋯` trigger.

## S2b — Strip center chrome ✅
- [x] T2.9 — Both `week-nav-btn` brick groups deleted from `makeNodeGroup`'s `isCenter` branch.
- [x] T2.10 — `.gear-btn` group and `.center-outer-pill` rect deleted.
- [x] T2.11 — 69 lines of `.gear-btn` / `.gear-bg` / `.center-outer-pill` / `.week-nav-*` CSS deleted.
- [x] T2.12 — Both `.week-nav-btn` guards and the `.gear-btn` guard removed; the
      gear and week-nav click listeners deleted with them.
- [x] T2.13 — Center label → `centerDisplayName()` in `_computeNodeSize` and the render
      path; the transitional `multiline` flag retired as promised in S1.
- [x] T2.14 — `npm test` 838 passed with `layout` / `reset-view` / `zoom` **unmodified**
      (`git diff --stat` on all three is empty), `npm run validate` clean.

### S2b verified in a real browser
| Check | Result |
|---|---|
| Signed out / signed in root label | `You` → `Petr` (via the stored-auth restore path) |
| Root node box | 240×82 single pill — was 240×~242 with the bricks |
| `+ Branch` buttons | both still present |
| Stray `.week-nav-btn` / `.gear-btn` / `.center-outer-pill` in the DOM | zero |
| Right-click the root | week menu opens with Transfer Unfinished and Clear the Week |
| Drag the root | still pans the canvas |

### S2b additions beyond the plan
- **Sign-in and sign-out now `scheduleRender()`.** The S1 note turned out to be real:
  nothing redrew the map on an identity change, so the root would have kept the stale
  wording. A text patch would not do — the node's width follows its label, and a 16-char
  name exceeds the 240px minimum.
- **`formatWeekLabel` was left with no callers** once the root stopped using it, while
  `updateWeekBar` re-joined the same two parts by hand. Pointed the latter at the former
  rather than leaving dead code beside a duplicate.

---

## ⏸ C2 checkpoint — awaiting human review before S3 (the ring)

## S3 — Circular root: avatar + completion ring ✅
Scope grew on 2026-08-17: the root goes circular and shows the user's avatar. See
plan AD3 (superseded) and AD8.
- [x] T3.1 — `NODE_STYLE.center` → **200×200, `rx: 100`**; `_computeNodeSize` pins the
      center to a square so "circle" is a guarantee, not a coincidence of label length.
- [x] T3.2 — i18n: `center.you` → `center.me` (`Me` / `Já`); S1's tests updated.
- [x] T3.3 — `canShowAvatarPhoto()` extracted from `showSignedInAvatar`, shared by the
      toolbar and the root; the `online` listener also schedules a render.
- [x] T3.4 — Root interior: initials disc (`googleUserInitialsColor` +
      `googleUserInitials`) with the photo `<image>` layered over it in a
      `#center-avatar-clip` circular clip; `Me`/`Já` when signed out; `<title>` carries
      `centerDisplayName()`. The generic label pass is skipped for the root, or it
      would paint text over the photo.
- [x] T3.5 — Ring inset at r=90, stroke 8, inside the r=100 node; avatar r=80.
- [x] T3.6 — `updateCenterRing()` called from `updateSummary()`.
- [x] T3.7 — Empty week → whole track, no arc, identical silhouette.
- [x] T3.8 — Click-without-drag on the root opens Stats.
- [x] T3.9 — `ctx-current-week` + `ctx-sep-current-week` deleted: markup, show/hide
      logic, click handler and both `menu.currentWeek` translations.
- [x] T3.10 — Tests: `centerNodeText` tiers, `center.me`, ring circumference and dash
      mapping — 845 passing.
- [x] T3.11 — `npm test` + `npm run validate` green; `layout` / `reset-view` / `zoom`
      **unmodified** despite the size change, which is AD3's revision made good.

### S3 verified in a real browser
| Check | Result |
|---|---|
| Geometry | `200x200 rx100` — a circle |
| Signed out | face `Me`, title `Me`, no initials disc, no photo |
| Signed in, no photo | face `PB`, title `Petr`, initials disc present |
| Signed in with photo | photo layered over the `PB` disc, clipped round |
| Ring vs Stats donut | ring 40%, donut `40%` — same number |
| `D` on an activity | dash 180.96 → 194.53 with no full render (AD4 holds) |
| Empty week | dash `0 565.49`, track whole, box still 200×200 |
| Click the root | `data-view` becomes `stats` |
| Branch edges | meet the circle at `(±100, 0)`, clear of the r=90 ring |

### S3 additions beyond the plan
- **200px, not 160.** At 160 the circle read as *smaller* than the 160×64 branches it
  anchors — a circle carries less visual mass than the pill it replaced. Caught by
  looking at a screenshot, not by any assertion.
- **`stroke-linecap` is conditional.** A round cap paints a dot even on a zero-length
  dash, so an untouched week showed a stray green pip at 12 o'clock. Build and patch
  now share `setCenterRingArc()` so they cannot disagree about it.
- **Face font sizes differ by tier** — 52 for initials, the node's own 34 for `Me`/`Já`.

### Carried into S5
`scripts/og-image.mjs` still swaps the root's text for a marketing line
(`centerLabel: 'My week'`). The root no longer carries a week label at all, so that
substitution needs rethinking rather than retargeting — an avatar-bearing root in a
marketing image is a stranger's face.

## S4 — Day-filter chip to the bottom stack ✅ *(pulled forward, see note)*
- [x] T4.1 — Added `--stack-l1: 62px` / `--stack-l2: 118px` / **`--stack-l3: 174px`**.
- [x] T4.2 — Chip → `l1`, and `l2` under `html.view-levels-open`, with a
      `transition: bottom` matching the row's own fade.
- [x] T4.3 — `#view-level-bar` and `#view-level-toast` retargeted at the same vars.
- [x] T4.4 — Toast steps to `l2` over a visible chip, `l3` when the row is open too.
- [x] T4.5 — Measured at 390: bottom bar 744 → row 692..738 → chip 650..682 →
      toast 592..626. Zero overlaps across all four state combinations, EN + CS.
- [x] T4.6 — `npm test` 838 passed, `npm run validate` clean.

### Why S4 moved up, and the extra rung
- **Pulled forward into S2a's commit.** The plan called S4 independent, but both
  elements want `top:68px`: leaving the chip there for a slice would have shipped a
  commit where an active day filter overlaps the new bar. They land together.
- **`--stack-l3` was missing from the plan.** The toast is not view-level-only —
  `showToast` also serves multi-tab updates, quota errors and "moved to next week", so
  it can appear with the row closed. Chip visible + row open needs a third rung, or the
  toast lands on the chip. Two rungs were not enough.

## S5 — Assets
- [ ] T5.1 — `scripts/og-image.mjs`: drop the dead `.gear-btn, .week-nav-btn` selectors,
      update the comment, decide the ring (recommend strip).
- [ ] T5.2 — `npm run og` → regenerate `og-image{,-cs}.{png,svg}`.
- [ ] T5.3 — `npm run screenshots` + `npm run hero:svg` with canonical test data.
- [ ] T5.4 — `npm run build` green (confirm `csp-hashes` is a no-op, do not assume).
- [ ] T5.5 — CHANGELOG entry.
- [ ] **C4 checkpoint** — complete, ready for review.

# TODO — Center Node Reboot: Identity In, Chrome Out

Plan: `tasks/center-node-reboot-plan.md` · Idea: `docs/ideas/center-node-reboot.md`
Order: **S1 → S2a → S2b → S3 → S5**. S4 (chip) is independent and may land any time
after S1. Check off only when AC + verification pass.

## S1 — Pure helpers
- [ ] T1.1 — `centerDisplayName()`: first token of stored Drive `displayName` → email
      local-part → `t('center.you')`; clamp 16 chars.
- [ ] T1.2 — i18n EN+CS: `center.you` (`You` / `Ty`).
- [ ] T1.3 — `roundedRectPathD(w, h, rx)` → `{ d, perimeter }`, origin top-center, clockwise.
- [ ] T1.4 — `formatWeekLabel()` → single line (drop `\n`); confirm by grep that only
      `_computeNodeSize` and the center render consume it.
- [ ] T1.5 — Export all three from `tests/setup.js`; new `tests/center-node.test.js`.
- [ ] T1.6 — `npm test` + `npm run validate` green.
- [ ] **C1 checkpoint** — app unchanged except a one-line center label.

## S2a — `#week-bar`
- [ ] T2.1 — Markup inside `#canvas-container`: `‹` · label button · `⋯` · `›`,
      with `data-i18n-title` / `data-i18n-aria` on every control.
- [ ] T2.2 — CSS at `top:68px`, styled as a peer of `#day-filter-chip`; date range
      hidden below 360px.
- [ ] T2.3 — i18n EN+CS: `weekbar.today`, `weekbar.actions` (reuse `nav.prev`/`nav.next`).
- [ ] T2.4 — Arrows → `loadAndRender(offsetWeek(currentWeekKey, ±1))`, today-direction accent.
- [ ] T2.5 — Label button → `loadAndRender(todayWeekKey())`; accent tint while off-current.
- [ ] T2.6 — `⋯` → `showContextMenu()` for `center`, anchored to its own rect.
- [ ] T2.7 — `updateWeekBar()` called from `loadAndRender`, `hashchange` and `applyTranslations()`.
- [ ] T2.8 — `npm test` + `npm run validate` green.

## S2b — Strip center chrome
- [ ] T2.9 — Delete the two `week-nav-btn` brick groups from `makeNodeGroup`'s `isCenter` branch.
- [ ] T2.10 — Delete `.gear-btn` and the `.center-outer-pill` rect.
- [ ] T2.11 — Delete the `.week-nav-*` and `.center-outer-pill` CSS blocks.
- [ ] T2.12 — Remove both `e.target.closest('.week-nav-btn')` guards (`pointerdown`, `click`).
- [ ] T2.13 — Center label → `centerDisplayName()` in `_computeNodeSize` **and** the render path.
- [ ] T2.14 — `npm test` green with `layout` / `reset-view` / `zoom` tests **unmodified**.
- [ ] **C2 checkpoint** — week nav works at any zoom/pan; human review before the ring.

## S3 — Completion ring
- [ ] T3.1 — Track path (`--border-soft`) + accent arc via `stroke-dasharray` from
      `computeWeekStats().global.percent`.
- [ ] T3.2 — `updateCenterRing()`, called from `updateSummary()`.
- [ ] T3.3 — Empty week → track only, no accent arc.
- [ ] T3.4 — Click-without-drag on the center opens Stats (reuse the `#vtb-stats` path).
- [ ] T3.5 — Test: arc length for a known week fixture; manual `D`-toggle vs Stats donut.
- [ ] T3.6 — `npm test` green.

## S4 — Day-filter chip to the bottom stack *(independent after S1)*
- [ ] T4.1 — Add `--stack-l1: 62px` / `--stack-l2: 118px`.
- [ ] T4.2 — Chip → `l1`, and `l2` under `html.view-levels-open`.
- [ ] T4.3 — Retarget `#view-level-toast`'s two offsets at the same vars.
- [ ] T4.4 — Toast steps up over a visible chip via `body:has(#day-filter-chip.visible)`.
- [ ] T4.5 — Verify all four state combinations at 320px and desktop.
- [ ] T4.6 — `npm test` + `npm run validate` green.
- [ ] **C3 checkpoint** — full manual pass: both languages, both themes, phone + desktop.

## S5 — Assets
- [ ] T5.1 — `scripts/og-image.mjs`: drop the dead `.gear-btn, .week-nav-btn` selectors,
      update the comment, decide the ring (recommend strip).
- [ ] T5.2 — `npm run og` → regenerate `og-image{,-cs}.{png,svg}`.
- [ ] T5.3 — `npm run screenshots` + `npm run hero:svg` with canonical test data.
- [ ] T5.4 — `npm run build` green (confirm `csp-hashes` is a no-op, do not assume).
- [ ] T5.5 — CHANGELOG entry.
- [ ] **C4 checkpoint** — complete, ready for review.

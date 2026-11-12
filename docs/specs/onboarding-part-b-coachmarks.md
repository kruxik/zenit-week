# Spec - Onboarding Part B: Progressive Coachmarks

Status: **Implemented** on `main` · Owner: Petr. The `HINTS` registry in `zenit-week.html` is the source of truth for the catalog; sections 4 and 7 below were brought up to date on 2026-11-12, the build slices in section 6 are history.
Relates to: [`onboarding-part-a-playground.md`](onboarding-part-a-playground.md) · [`../ideas/onboarding-playground-week.md`](../ideas/onboarding-playground-week.md)

## 1. Goal
Teach features at the moment they're relevant. The first time a user reaches a given context, show one small coachmark explaining what they can do - then never again. Cures "never discovered the feature" without a tour or reading.

## 2. Confirmed decisions
- **Audience / reset:** All users (not just playground), **once-ever per hint**. Seen-state persisted.
- **Persistence:** seen-state (`zenit-week-tips-seen`, capped at `MAX_TIPS_SEEN`) and the Show tips switch are stored locally and synced across devices in the settings (colors) blob on Drive. Both are device facts kept by every local wipe (`ONBOARDING_DEVICE_KEYS`).
- **UI:** **Coachmark bubble** anchored to the target element, with an arrow pointing at it, body text, a **Got it** button, and a subtle line that tips can be turned off in Settings.
- **Global toggle:** A **"Show tips"** setting (default ON) in Settings. When OFF, no coachmarks fire.
- **Pacing:** one coachmark on screen at a time; marked seen on "Got it" or Esc, or once it has been on screen for `COACHMARK_SEEN_MS` (1.5 s), so a tip read and moved past is not shown again. Each coachmark notes tips can be disabled in Settings (so "Got it" isn't the only signal).
- **First batch of hints:** Core hover keys · Magic counters & days · Views & navigation. (Context menu deferred.)

## 3. The hint engine
A small registry + controller, all in `zenit-week.html`.

### Registry
Each hint: `{ id, textKey, anchor, when }`
- `id` - stable string, used as the seen-flag key (e.g. `hover-keys`, `counter`, `days`, `views`).
- `textKey` - i18n key for the body (EN + CS).
- `anchor` - a function returning the DOM element (or rect) to point at, evaluated at fire time.
- `when` - optional extra predicate (e.g. only if a counter node is visible).

### Controller - `maybeShowHint(id, anchorEl)`
Fires from context event handlers. Shows the coachmark iff **all**:
1. tips enabled (`tipsEnabled()`),
2. hint not already seen (`isHintSeen(id)`),
3. no coachmark currently visible (single-at-a-time),
4. `when` predicate (if any) passes,
5. a valid anchor element exists.
On show: position bubble near `anchorEl` with arrow; on **Got it**: `markHintSeen(id)` + hide.

### Storage seam (local-first; the future Drive-sync boundary)
A thin module so sync can be added in one place later:
- `tipsEnabled(): boolean` (default true)
- `setTipsEnabled(bool)` → persist
- `isHintSeen(id): boolean`
- `markHintSeen(id)` → persist
- In-memory cache loaded at boot; backed by IDB `misc`:
  - `zenit-week-tips-enabled` → boolean
  - `zenit-week-tips-seen` → `{ [id]: true }`
- **Seam note:** these are the only functions that touch storage; Drive sync (later) wraps them, ideally riding the settings blob once §7 is fixed.

### Coachmark UI
- One reusable element `#coachmark` (bubble + arrow + text + "Got it" + "tips off in Settings" line).
- Positioned via JS relative to the anchor's `getBoundingClientRect()`; arrow flips above/below to stay on screen.
- Built with DOM construction / `textContent` (no `innerHTML` with dynamic data - XSS rule).
- Styled to match app surfaces (reuse tokens; "Got it" = `.btn`).
- Esc dismisses (counts as seen). Clicking elsewhere does **not** dismiss (avoid accidental skip) - TBD, tune in PB1.

## 4. Hint catalog
Seventeen hints, in `HINTS` order. Each is either a plain text (`textKey`) or an intro with kbd rows (`introKey` + `keys`); some carry touch variants (`touchCaptionKey`, `touchTextKey`). Triggers live at the call sites, not in the registry.

| # | id | Teaches |
|---|----|---------|
| 1 | `done` | Marking done |
| 2 | `unplanned` | Unplanned tasks |
| 3 | `counter` | `Nx` ticks |
| 4 | `days` | Day selectors |
| 5 | `priority` | Priority and its layout weight |
| 6 | `inbox` | The quick-add inbox |
| 7 | `hover-keys` | Hotkeys on a hovered or focused node (touch variant) |
| 8 | `undo` | Undo / redo |
| 9 | `views` | The four views (V / M / A / S) |
| 10 | `levels` | Rocks / Pebbles / Sand (`W`) |
| 11 | `root` | The root node |
| 12 | `signin` | Drive sign-in |
| 13 | `weeknav` | Week navigation |
| 14 | `quickadd` | Quick add (`Q`) |
| 15 | `dayfilter` | The day filter |
| 16 | `vision` | What the Vision is; shown on the Vision tab the first time the Vision opens |
| 17 | `horizonfilter` | The horizon filter (`1`-`4`) on the Vision |

On the Vision a hint reads its `<key>Vision` string where one exists (`recordKey()`), so #5, #7 and #11 say "intention" instead of "task". The week-only hints (#1-#4, #6, #13, #15) cannot fire there: their nodes or controls do not exist on the Vision. Quick add (#14) works on the Vision and adds an intention.

## 5. Settings toggle
- Add a "Show tips" row to the Settings dropdown (near theme/lang), checkbox/switch, default ON.
- Reflects + writes `setTipsEnabled`. Turning OFF hides any visible coachmark.
- i18n: `settings.tips` label, plus `tips.disableHint` ("You can turn tips off in Settings") for the coachmark footer.

## 6. Slices (vertical; build order)
- **PB1 - Engine + UI + toggle + one pilot hint (`hover-keys`).** Full vertical: registry, controller, storage seam, `#coachmark` bubble + positioning, Settings toggle, EN/CS for the pilot. Tests for the seam + gating. **Checkpoint CB1** (browser: hover a node → bubble → Got it → never again; toggle off works).
- **PB2 - `counter` + `days` hints.** Wire triggers, anchors, i18n, tests.
- **PB3 - `views` hint** + any nav. Wire trigger, i18n, tests.
- **PB4 - polish pass:** positioning edge cases (screen edges, mobile), Esc/scroll behavior, copy tuning. (Expected fine-tuning bucket.)

Each slice: code + EN/CS + vitest for pure logic (gating/seam) + `npm test` & `npm run validate` green.

## 7. Cross-device sync
Resolved: the settings blob syncs through Drive, and seen-state and the Show tips switch ride on it (section 2). A hint seen on one device is not shown on another.

## 8. Acceptance criteria (whole of Part B)
1. Each hint fires at most once ever (persists across reloads).
2. "Show tips" OFF suppresses all coachmarks; ON restores (for unseen hints).
3. Only one coachmark visible at a time.
4. Coachmark is anchored to the right element and stays on screen.
5. No `innerHTML` with dynamic strings; EN + CS complete.
6. `npm test` + `npm run validate` green per slice.

## 9. Open questions / tuning
- Exact copy per hint (EN + CS) - tune with mentees.
- `views`/`days` trigger definitions - most likely to change.
- Click-outside dismiss vs Got-it-only.
- Mobile presentation (no hover; long-press / tap contexts).

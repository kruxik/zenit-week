# Spec — Onboarding Part A: The Seed Playground

Status: **Draft** · Owner: Petr · Relates to: [`docs/ideas/onboarding-playground-week.md`](../ideas/onboarding-playground-week.md)
Seed content: [`assets/playground-seed.json`](../../assets/playground-seed.json)

## 1. Goal
On first use, the canvas is never blank: a believable, fully-featured week loads automatically so the user feels the app's power immediately (mindmap + agenda + balance stats all populated). The user freely plays with it; seed nodes they don't touch are later removed by a gentle one-tap cleanup, converting the playground into their real week.

Out of scope (separate builds): progressive coachmarks (Part B); settings-based playground tuning/re-entry.

## 2. Trigger — when does the seed load?
The seed loads on boot when **either** condition holds *and* it is safe (no data would be clobbered):

1. **Empty database** — `listWeekKeysIDB()` returns `[]` (genuine first run), **or**
2. **`#playground` anchor** — `location.hash === '#playground'`.

**Safety gate (both paths):** only seed the current ISO week (`todayWeekKey()`) if that week has **no existing record** in IDB. If the user already has data for the current week, do **not** seed (prevents clobbering real work when an existing user opens `#playground`).

**Idempotency:** after a successful seed, write `zenit-week-onboarded = true` to the `misc` store (`saveValueIDB`). The empty-DB path additionally won't re-fire because the DB is no longer empty. The `#playground` path is guarded by the safety gate + the onboarded flag.

### Recommended defaults (open questions resolved)
- **Q — existing-user re-entry via `#playground`:** In MVP, `#playground` only seeds when the current week is empty (safety gate). It is effectively a first-run/empty path. A dedicated "re-explore the example" entry point is **deferred to settings, post-MVP**. *Default: gated, no clobber.*
- **Q — anchor stripping after seeding/cleanup:** Immediately after seeding, strip the hash via `history.replaceState(null, '', location.pathname + location.search)` so a reload does not re-trigger and the URL is clean. The onboarded flag is the durable guard; the strip is hygiene. *Default: strip on seed.*
- **Q — auto-nudge threshold:** see §5.

## 3. Seeding sequence
Hook a new `await maybeSeedPlayground()` into the init flow at `zenit-week.html:~14550`, **after** `runMigrationIfNeeded()` and **before** computing `initialWeek`/`loadAndRender()`.

`maybeSeedPlayground()` does:
1. Evaluate the trigger + safety gate (§2). Bail if not seeding.
2. Load `assets/playground-seed.json`.
   - The app runs from `file://` and as a deployed page. **Embed the seed as a JS constant in `zenit-week.html`** (Single File Policy — `fetch` of a sibling file fails under `file://`). The JSON file remains the editable source of truth; the build inject step mirrors it into the constant (see §8).
3. Build the week object:
   - `weekKey = todayWeekKey()`.
   - For every node: stamp `_demo: true` and a fresh `_ts = Date.now()`. Keep existing ids (seed ids are unique and self-consistent).
   - Set `tombstones: []`, `crdtVersion: 0` (matches `loadWeek`'s new-week shape).
4. Apply branch colors from the seed (`work/family/me/growth`) via the existing colors path (`saveBranchColors` / `COLORS_STORAGE_KEY` + `zenit-week-colors` in `misc`), so Growth renders green deterministically.
5. `await saveWeekIDB(todayWeekKey(), week)`.
6. `await saveValueIDB('zenit-week-onboarded', true)`; strip the hash (§2).
7. Return; normal `loadAndRender(initialWeek)` then displays the seeded week.

## 4. `_demo` flag — drop-on-touch
A seed node stops being demo scaffolding the moment the user makes it theirs. Add a helper:

```js
function clearDemo(nodeId) {
  const n = findNode(nodeId);
  if (n && n._demo) { delete n._demo; }   // saved by the caller's existing saveWeek
}
```

Call `clearDemo(id)` from each user-mutation entry point, for the affected node (and, where it implies ownership, its ancestors are **not** auto-cleared — only the directly touched node):

- **Rename / label commit** — inline input commit (`_openInlineInput` commit path).
- **Move / drag** — drop handler (`moveNode`-style reposition; `offX/offY/side` change).
- **Done / Unplanned toggle** — the setters behind `D`/`U` and context menu.
- **Priority change** — priority setter.
- **Counter tick / increment** — counter `val` change.
- **Add child / add node** — the **new** node is user-created (never gets `_demo`); additionally `clearDemo(parentId)` because the parent now holds real structure.
- **Delete** — N/A (node is gone); deleting a demo node is fine and reduces leftovers.

A "touched" node = any of the above. Color/theme/zoom/pan changes are **not** touches (they don't make a specific node "yours").

> Implementation note: there is no single node-aware chokepoint — `takeSnapshot()` (32 callers) is node-agnostic. Hook the individual mutators listed above. Keep the list in sync if new mutators are added.

## 5. Cleanup — "Clear the leftovers"
Removes only nodes still carrying `_demo: true`, preserving everything the user touched or created.

### 5a. Manual action
- A permanent entry in the Help panel labeled e.g. **"Clear example tasks"** (plus the transient banner button in §5b).
- Routes through `showAppConfirm({ title, body, okLabel, danger:true, onConfirm })` (no native dialogs).
- On confirm: `takeSnapshot()` (so it's undoable), then `tombstoneNodes()` + remove all nodes where `_demo === true` (and their now-empty branch? — **no**: keep branches; a branch the user kept tasks under stays, an all-demo branch's children vanish but the branch remains, matching "keep structure they saw"). Then `rebuildNodeMap()`, `saveWeek()`, `render()`.
- After cleanup, set `zenit-week-onboarded` already true; nothing re-seeds.

### 5b. Gentle auto-nudge — recommended default
- **Trigger:** the first boot/interaction where **both**: (a) the user has touched-or-created **≥ 3** nodes (count of non-`_demo` nodes minus the seed's original branch count, i.e. real user nodes ≥ 3), **and** (b) **≥ 1** `_demo` node still remains.
- **Form:** a non-blocking, dismissible inline banner/toast: *"Done exploring? Clear the example tasks and keep your own."* with a **Clear** button (runs 5a) and a **Dismiss**.
- **Frequency:** show **once**. On dismiss or action, set `zenit-week-playground-nudged = true` in `misc`; never nudge again.
- Rationale for 3: low enough to fire in the first real session, high enough that it doesn't pop on the first accidental edit.

## 6. i18n
All new strings (`#playground` is not user-visible) added to both `TRANSLATIONS.en` and `TRANSLATIONS.cs` via `t(key)`:
- `onboarding.clearExample` (button), `onboarding.clearConfirmTitle`, `onboarding.clearConfirmBody`, `onboarding.clearConfirmOk`, `onboarding.nudge`, `onboarding.nudgeDismiss`.

Buttons reuse `.agenda-action-btn`; confirm uses the existing danger variant tokens.

## 7. Acceptance criteria
1. Fresh profile (empty IDB) → on first load the current week shows the full seeded mindmap; agenda and summary/balance panels are populated. ✅ when visible without any user action.
2. Reload after seeding → **no** re-seed, no duplicate nodes; URL has no `#playground`.
3. Existing user with data for the current week opens `#playground` → data is **not** clobbered; no seed applied.
4. Editing a seed node (rename / move / done / unplanned / priority / counter tick / add child) removes its `_demo` flag (verify in persisted IDB record).
5. "Clear example tasks" removes exactly the untouched demo nodes; all user-touched/created nodes and all branches remain; action is undoable (Ctrl/⌘+Z restores).
6. Auto-nudge fires once after ≥3 real user nodes exist with ≥1 demo node remaining; never reappears after dismiss/action.
7. Growth branch renders green (`#0ACF83`); work/family/me keep default colors.
8. EN + CS strings present; `npm test` and `npm run validate` pass.

## 8. Build decisions (confirmed)
- **Seed embedding mechanism:** ✅ **Inject step.** A tiny script (mirroring `scripts/inject-version.js`) reads `assets/playground-seed.json` and writes it into a constant in `zenit-week.html` at build time. The JSON file remains the single editable source of truth. Add it to the `build` npm script.
- **Cleanup UI placement:** ✅ **Banner + Help entry.** Transient nudge banner with a Clear button (§5b), **plus** a permanent entry in the Help panel (§5a) so the action is findable after the banner is dismissed.
- **Branch handling on cleanup:** ✅ **Always keep branches.** Cleanup removes only `_demo` activity/counter nodes; all four branches (Family/Work/Me/Growth) survive even if every child was demo. Preserves the structure the user saw.

## 9. Test plan (vitest)
Add `tests/onboarding-seed.test.js` (uses existing `fake-indexeddb`):
- empty-DB trigger seeds; populated-DB does not.
- `#playground` safety gate.
- onboarded flag prevents re-seed.
- `clearDemo` drops flag per mutator (unit-level).
- cleanup removes only `_demo` nodes, keeps branches + user nodes, is snapshot-undoable.
- nudge threshold logic (≥3 user nodes + ≥1 demo remaining, once).

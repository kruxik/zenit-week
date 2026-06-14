# Onboarding: The Playground Week

## Problem Statement
**How might we make a first-time user feel Zenit Week's power in their first session — fixing both blank-canvas paralysis and "I don't get the point" — without making them read anything?**

## Recommended Direction
A two-part onboarding, **built and shipped separately**.

**Part A (ship first) — the seed playground.** On first use the canvas is **never blank**: a believable, fully-featured week loads automatically — three branches, an in-progress counter (e.g. "Pushups 30x"), some done/unplanned tasks, a populated agenda, and a live balance/effort reading. There is **no "blank vs. example" prompt** — we start seeded so curiosity does the work. The user immediately plays: edit, drag, rename, add, delete. Seed nodes carry a `_demo` flag that **drops the instant a node is touched**. Cleanup is surgical and comes *later in the flow*: a **gentle auto-nudge** (once the user has created/touched enough of their own nodes) plus a manual action removes only the still-untouched demo scaffolding — keeping everything the user made. This turns exploration directly into a real week, with every feature visible from second one.

**Part B (ship after A is tuned) — progressive coachmarks.** Just-in-time, one-at-a-time hints fired on the *first* occurrence of a context — hover a node (Enter/Tab/Delete), open a counter (quantity selector), use the day selector, open the context menu. Each shows once (tracked in `localStorage`), reusing the existing `#custom-tooltip` styling. Teaches features at the moment they're relevant — the real cure for "never discovered it." Built only after the playground content is validated on real mentees.

Both parts work for guided mentees *and* cold web visitors — nothing depends on the author being in the room.

## Key Assumptions to Validate
- [ ] **The seed week triggers aha.** Test: load it for 3 mentees, watch faces. Do they say "oh, this shows my *whole* week"? The seed content is the product here — tune it before more code. (Author knows the mentees; content tuning is owned, not a blocker.)
- [ ] **Auto-seed-then-cleanup is intuitive.** Test: do users understand the cleanup keeps their own work and only removes demo leftovers? Watch for fear of losing edits.
- [ ] **The auto-nudge fires at the right time.** Define the threshold (N user-touched/created nodes) so the nudge feels helpful, not nagging.
- [ ] **`_demo`-drop-on-touch is unambiguous.** Define "touched" precisely: label change, move, done/unplanned toggle, counter tick, priority change, or any child added under the node.
- [ ] **Just-in-time hints help, not annoy.** Validated only in Part B, after Part A lands.

## MVP Scope (Part A only)
**In:**
- **First-run trigger:** empty IndexedDB (no existing week records) **and/or** the `#playground` URL anchor → load the seed.
- **Seed content:** reuse the week currently depicted in `screenshot.svg` as the seed `weekData` (to be refined later by the author).
- Seed nodes flagged `_demo: true`; flag drops on any edit/move/status/counter/child-add to that node.
- **Cleanup:** gentle auto-nudge once the user has created/touched enough of their own nodes, plus a manual action; both route through `showAppConfirm` (no browser dialogs) and delete only remaining `_demo` nodes.
- EN + CS strings via existing `TRANSLATIONS`; any buttons reuse `.agenda-action-btn`.

**Out of MVP:**
- Progressive hint engine + seen-hints tracking + per-context triggers (**Part B**, separate build).
- Settings-based tuning of the playground (e.g. re-load example, pick content). Deferred to a later iteration.

## Not Doing (and Why)
- **"Blank vs. example" first-run prompt** — decided against; we auto-seed so curiosity drives exploration, no extra choice.
- **Guided multi-step tour / wizard** — fights "aha in first session"; reading by another name. The seed *shows*, doesn't tell.
- **Templates gallery (Student/Founder/Parent)** — busts scope; one great seed first.
- **Video / animated walkthrough** — nobody watches it; same failure mode as the unread Help page.
- **Building Parts A and B together** — validate the playground aha (and tune its content) before investing in the hint framework.
- **Touching the landing web page** — different surface, different sprint; the in-app fix is the leverage point.
- **Settings tuning of the playground in MVP** — nice-to-have, deferred until the core flow proves out.

## Open Questions
- Auto-nudge threshold: how many user-touched/created nodes before we suggest clearing the leftovers?
- Should `#playground` also let *existing* users re-enter the seeded playground on demand (e.g. from Help), or is it strictly a first-run/empty-DB path?
- After cleanup, do we keep the `#playground` anchor in the URL or strip it so reloads don't re-seed?

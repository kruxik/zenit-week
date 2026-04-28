# Agenda & Day Filter

## Problem Statement

How might we give users practical, visual control over day-scheduled activities — both in the mindmap and as a standalone daily planning interface (Agenda)?

## Recommended Direction

### Track A — Prerequisite: Restructure Day-Selector Nodes

Currently `"Running (mo, we, fr)"` creates one activity + one counter child (max=3). This compresses multiple scheduled instances into one node, making per-day management impossible.

**New behaviour:** `"Running (mo, we, fr)"` creates a parent node `"Running"` with three children: `mo`, `we`, `fr` — using magic abbreviations as leaf labels. Each leaf is an independent activity with its own done/unplanned state. When all children are done the parent auto-marks done (existing cascade behaviour).

`"Duolingo (daily)"` → parent `"Duolingo"` + 7 day-children (one per day abbreviation).

Non-day counters (`"Reading 3x"`) survive unchanged — the counter mechanic stays for "X times per week, any day" use cases. Where these appear in Agenda needs its own deepdive (see U1).

The `(day)` syntax in labels becomes a **creation shorthand** — parsed once on node commit, stripped from the parent label, children created. The label is not re-parsed at runtime.

Migration required for existing nodes using the old counter+day format (see U5).

**This track is a prerequisite for Tracks B and C.**

---

### Track B — Agenda (replaces "Today's Overview" / Todo Panel)

A full-featured day-planning interface. Primary UI mode on mobile; secondary (panel/FAB) on desktop. Must be fully functional standalone — create, rename, reschedule, done, delete — without needing the mindmap.

**Day strip:** 7 tabs (Mo–Su), defaults to Monday (first day of week). Each tab shows that day's scheduled leaf nodes, labelled by parent (e.g. "Running", not "mo").

**Overdue tab:** Separate tab with bubble badge showing count. Contains undone activities from past days of the **current week only** — cross-week overdue is out of scope. Not mixed into daily lists; not forced to top.

**Context menus + keyboard shortcuts** mirror the mindmap: rename, reschedule (change leaf's day), done, delete, priority, unplanned.

**Mobile gestures:** Swipe-right = done. Swipe-left = open context menu.
> ⚠️ U2 — Swipe directions tentative. Verify with user before building.

**View switching:** A dual-button at the bottom of the viewport (within thumb reach on mobile) toggles between Agenda and Mindmap views. Desktop defaults to Mindmap; user can switch. Mobile defaults to Mindmap; user can switch. The mindmap is the app's bedrock — Agenda is an alternative lens, not a replacement.

---

### Track C — Mindmap Day Filter

A new filter layer compositing with the existing rocks/pebbles/sand depth filter.

**Hotkeys 1–8** (desktop only):

| Key | Filter |
|-----|--------|
| 1 | Monday |
| 2 | Tuesday |
| 3 | Wednesday |
| 4 | Thursday |
| 5 | Friday |
| 6 | Saturday |
| 7 | Sunday |
| 8 | No day selector ("Octarina" — unscheduled nodes) |

**Dual behaviour based on hover context:**
- Cursor on **canvas** → press key → filter view to that day (non-matching nodes fade/hide)
- Press same key again → toggle filter off
- Cursor on a **node** → press key → assign that day to the node
> ⚠️ U3 — Pressing a key while hovering a **parent** node (e.g. "Running" with existing day-children) — create new child? Do nothing? Behaviour undefined.

**Escape hatch:** Day filter toggle also accessible via the Week/center node settings panel. Prevents users from getting stuck after an accidental key press.

---

## Key Assumptions to Validate

- [ ] Users are comfortable with the parent→child day structure in the mindmap (more nodes visible)
- [ ] Agenda as standalone UI satisfies mobile use without needing mindmap access
- [ ] Overdue as a separate tab (not surfaced aggressively) matches how users treat unfinished recurring tasks
- [ ] Bottom dual-button placement is ergonomic on common mobile screen sizes

## MVP Scope

**Track A first (blocking):**
- Parse `(day)` on node commit → create parent + day-children
- Strip day tokens from parent label
- Each day-child: independent done/unplanned, cascades up on completion
- Migration for existing counter+day nodes

**Track B second:**
- 7-day tab strip + Overdue tab with bubble badge
- Full context menu in Agenda (rename, reschedule, done, delete)
- Bottom dual-button toggle (Agenda ↔ Mindmap)
- Keyboard shortcuts in Agenda (desktop)

**Track C third:**
- Keys 1–8 for mindmap filter (canvas context)
- Day assignment via hover-on-node + key
- Toggle in Week/center node settings as escape hatch

## Not Doing (and Why)

- **Cross-week overdue** — each week is self-contained; surfacing past weeks adds complexity without clear value
- **Mobile mindmap replaced by Agenda** — mindmap is the app's bedrock; users opt into Agenda-first themselves
- **"Reading 3x" in Agenda per-day view** — non-day counter placement in Agenda needs its own deepdive (U1)
- **Automatic day suggestion** — out of scope, no backend

## Flagged Uncertainties

> These must be resolved with the user before implementing — do not assume.

| ID | Topic | Detail |
|----|-------|--------|
| U1 | Non-day counters in Agenda | Where do `"Reading 3x"` items appear per-day tab? "Not sure ATM" — deepdive needed |
| U2 | Mobile swipe directions | Right=done confirmed; left=context menu is tentative |
| U3 | Hotkey on parent node | Pressing a key while hovering a parent with existing day-children — create new child or do nothing? |
| U4 | Duplicate day-child edge case | If `mo` already exists under "Running" and user types `(mo)` again — behaviour undefined |
| U5 | Data migration | How to handle existing counter+day nodes when Track A ships |

## Deferred / Future Analysis

| ID | Topic | Detail |
|----|-------|--------|
| F1 | Nx + day-pattern coexistence | Currently day wins and Nx is stripped silently. Should mixed labels like `"Running (mo, fr) 2x"` be an error, show a warning, or support a different semantic (e.g. Nx counter separate from day scheduling)? Needs deepdive before Track B ships. |

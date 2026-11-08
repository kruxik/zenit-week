# IDEA - Vision Canvas

> Captured 2026-11-08 from a design conversation. Spec: `docs/specs/vision-canvas.md`.

Zenit Week plans weeks. Nothing in it holds the reason a week is planned the way it is. The
Vision Canvas is that reason: one mind map of "my future life" - where I want to go and why -
kept inside Zenit Week, consulted when a week is planned, and read by the agent so it can
recommend what the coming weeks should carry.

## What it is

- One canvas, not one per area. The branches are the life areas (the week's branches are the
  seed), so "one canvas for work, one for family" falls out of the map itself.
- A mind map, drawn by the same renderer as the week. Same drag, colours, priority scaling,
  context menu, comment editor, Drive merge. What differs is the vocabulary: no days, no `Nx`,
  no done. A node is an intention, and its comment is its body.
- A fourth top-level view beside Mindmap, Agenda and Stats. The week views answer *what*, the
  Vision answers *why*.
- Agent first, link later. The agent reads the vision and the recent weeks and proposes tasks.
  A `vision` field on week tasks (the explicit link) is a later step; today's step gives the
  agent the material.

## What it is not

- Not a goal tracker. Progress is the week's job. The canvas never carries a percentage.
- Not a second app. Nothing is split out of `zenit-week.html`.
- Not many canvases, not yet. Multi-canvas means a picker, a sync file per canvas and a delete
  flow, with no insight to show for them until one canvas has been lived with.

## Why now

The agent bridge (merged 2026-11-08) can act on a week but has nothing to reason *from*. The
vision record is the cheapest thing that gives it a long view: one more resource, one more
navigation tool, and the existing node tools work on vision nodes by id.

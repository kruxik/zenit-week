# Send to the Future

## Problem Statement

Some commitments are real, dated, and far away: pay taxes on 31 March, electricity bill once a year, roadworthy check every two years, a birthday every 12 months. Today Zenit Week can hold a task for *this* week or push it to *next* week (`N`, `moveNodeToNextWeek`, `zenit-week.html:10656`) — and nothing else. How might we let a week-scoped planner hold hundreds of dated and repeating commitments, some years out, **without turning Zenit Week into a calendar**?

## The two constraints that decide the design

**1. There is no server, so there are no notifications.** A future item can only reach the user when they open Zenit Week in the relevant week. This is accepted, not worked around: *the weekly ritual is the delivery mechanism*. Anything that needs a phone alarm belongs in a real calendar, and `.ics` export is the escape hatch if that ever becomes necessary.

**2. Future items must not be pre-written into future week records.** Week records are the unit of persistence (`loadWeek`, `zenit-week.html:10069`) *and* the unit of Drive sync (`scheduleDriveSync`, `zenit-week.html:8501`). Planting hundreds of dated items into their target weeks means writing and syncing across a hundred-plus week keys, repeatedly and forever — and an infinite repeat rule cannot be materialised at all. Cold-planting is rejected on both counts.

Everything below follows from these two.

## Recommended Direction

### A schedule store, materialised on week open

One new non-week record — the **schedule** — holding *entries*, not nodes. An entry is a standing intention ("pay taxes, every year, 31 March"); an **occurrence** is what a week actually receives.

| Entry field | Meaning |
|---|---|
| id | stable identity across devices |
| label | the task text, as typed |
| branch | which branch the occurrence lands under |
| priority | carried onto the occurrence |
| anchor | the first occurrence's date, `YYYY-MM-DD` |
| repeat | `{ every: N, unit: 'day' \| 'week' \| 'month' \| 'year' }`, or none for a one-off |
| end | never / after N occurrences / until a date |
| cursor | the next occurrence not yet accounted for |
| _ts | CRDT timestamp, same LWW role as on nodes |

The record syncs to Drive as a single extra record with the same last-write-wins-per-entry and tombstone shape week records already use (`migrateCrdt`, `zenit-week.html:9966`). One record regardless of whether the user has five entries or five hundred.

**The cursor is what makes this cheap.** Work on opening a week is proportional to the number of *entries*, never to the number of occurrences a rule implies. Occurrences before the cursor are not history that must be stored — they simply never exist. A device that has been offline for a year does not materialise a year of missed work; it materialises each entry's cursor position and moves on.

### Lifecycle

| Moment | What happens |
|---|---|
| A week opens | Every entry whose next occurrence falls inside that week's Mon–Sun bounds (`getWeekBounds`, `zenit-week.html:9063`) materialises as an ordinary activity node under its branch, with a `dayChild` leaf on the right weekday. The node keeps a back-link to its entry and its occurrence date. |
| Occurrence closed — done, dropped or deleted | The entry's cursor advances to the next occurrence. The series continues; closing one occurrence never closes the series. |
| Occurrence missed | The cursor is still behind. On opening the current week, past-due occurrences materialise **into the current week**, where the existing overdue machinery (`getOverdueItems`, `zenit-week.html:12865`) chases them exactly like any other unfinished task. |
| Entry edited in the Later tab | Future occurrences only. Occurrences already materialised are plain nodes living in their own weeks. |
| Entry deleted | A confirm dialog (`showAppConfirm`) offers *this occurrence* or *the whole series*. |

A materialised occurrence is a **plain node**. It has no special rendering, no special drag behaviour, no special status rules. Everything the app already does to activities — priority, comments, day tags, counters, transfer, stats — works on it untouched. The only thing that marks it is the back-link, which exists so that closing it can advance the cursor.

Free win: an entry labelled with the `Nx` pattern materialises with its counter child auto-created, because counters derive from the label, not from the schedule.

### Boundaries with what already exists

- **`N` / move-to-next-week is unchanged.** It stays the fast path for "not this week, next week". *Send to date…* is a separate action for anything beyond that.
- **Send to date moves the node, it does not copy it.** The node leaves the current week and becomes an entry. There is one truth about where a task lives.
- **A materialised occurrence's edited label stays local.** Renaming this year's tax node does not rewrite the series. Series text is edited on the entry, in the Later tab.
- **`reusable` stays parallel for now.** It is, conceptually, a weekly repeat rule and should eventually converge with this engine — but migrating live user data is risk this feature does not need to carry.
- **Occurrences count as planned in stats**, never as `unplanned`. They were scheduled deliberately; they are the opposite of an unplanned arrival.

### Recurrence grammar (v1)

Fixed interval from an anchor date: every N days, weeks, months or years, with an optional end (never / after N / until a date). This covers taxes, bills, roadworthy checks, birthdays and subscriptions — the entire set of cases that motivated the feature.

No weekday-of-month ("first Monday"), no exception lists, no `BYSETPOS`. Month and year arithmetic clamps to the end of the month (31 January + 1 month lands on 28/29 February).

### The Later tab

A tab at the end of the Agenda's day-tab strip, after Sunday (`AGENDA_TAB_ORDER`, `zenit-week.html:16644`), reachable by `←`/`→` like any other tab and directly by **`L`** from anywhere. `L` was chosen because Later is a peer of Mindmap/Agenda/Stats, which are already letter-addressed — `9` collides with the numeric strip's day semantics, and hiding it behind a second press of `A` makes it undiscoverable.

Rows are grouped by month and show date, label and branch colour, reusing the agenda-row internals built by `buildAgendaItem()`. Unlike every other agenda row, these rows edit **entries**, not nodes: tapping one opens its date and repeat rule. That is the one genuinely new editing surface this feature adds.

### The anti-calendar line

Date granularity stops at *week + weekday*. No clock times, no durations, no events, no invitations, no attendees, no free/busy. Zenit Week schedules *intentions into weeks*; it does not schedule *appointments into days*. This line is what keeps the feature from metastasising, and it should be stated in the spec as a rule, not a v1 limitation.

## Key Assumptions to Validate

- [ ] **The weekly ritual is reliable enough to be the delivery mechanism.** Test: after shipping, deliberately skip a week with a dated entry in it and check whether the swept-forward overdue row actually feels like it caught you, or feels like it arrived too late to act.
- [ ] **Hundreds of entries stay legible in a single Later tab.** Test: seed 200+ entries and open the tab. If month grouping alone does not hold it, the tab needs search or branch filtering before the feature is usable at the stated scale.
- [ ] **One activity per entry is enough.** Test: try to express a genuinely multi-step yearly obligation (tax preparation) as a single entry. If it wants a subtree, this assumption is broken and the entry model needs to carry structure.
- [ ] **Cursor-only materialisation never loses an occurrence** across two devices that open the same week independently. Test: open the same target week on two devices offline, then sync, and confirm exactly one occurrence exists.

## MVP Scope

**In:**
- Schedule record with entries, synced to Drive as one extra record.
- *Send to date…* on an activity's context menu — moves the node out of the current week and creates the entry.
- Creating an entry directly from the Later tab.
- Interval recurrence: every N days / weeks / months / years, with an end condition.
- Materialisation of due occurrences when a week opens, plus a past-due sweep into the current week.
- Cursor advance on done / dropped / deleted.
- Later tab in the Agenda, hotkey `L`, entries editable in place.
- Delete confirm: this occurrence vs. the series.

**Out:**
- Everything in the next section.

## Not Doing (and Why)

- **Clock times, durations, events** — this is the line between a planner and a calendar; crossing it once makes every later "just one more field" argument unanswerable.
- **Notifications of any kind** — there is no server and no push, so promising a reminder would be a promise the architecture cannot keep.
- **Weekday-of-month rules ("first Monday")** — real date-math complexity and edge cases (a month with no fifth Monday) for cases that did not motivate the feature.
- **`.ics` export** — a reasonable later addition, but it is a bridge to a different tool, not part of making this one work.
- **Cold-planting nodes into future week records** — sync cost scales with item count and repeat rules cannot be materialised at all.
- **Subtrees on entries** — an entry carries one activity; if this proves wrong, assumption 3 above will say so before the model is entrenched.
- **Migrating `reusable` into the rule engine** — the right end state, but not while it means touching existing user data on the same release.
- **Lead-time warnings ("surface 3 weeks early")** — plausible and cheap to add later, but it multiplies the states an occurrence can be in before anyone has used the simple version.

## Open Questions

- Does the past-due sweep place a missed occurrence on its original weekday, or on the week's first day? The former preserves intent; the latter guarantees it reads as overdue.
- When *Send to date…* moves a node that has children, what happens to them — blocked with an explanation, or flattened into the label? (Blocking is the honest v1 answer.)
- Should the Later tab show a count badge like the Overdue tab does, and if so, counting what — entries, or occurrences inside some horizon?

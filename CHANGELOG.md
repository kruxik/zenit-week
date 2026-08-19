# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [CalVer](https://calver.org/) — `vYYYY.MM.DD[.N]`.

## [v2026.08.17] - 2026-08-17

### Added

- **hotkeys:** Add keyboard focus ring and document every shortcut
- **center:** Circular root with the user's avatar and a completion ring
- **week-bar:** Navigate weeks from a fixed bar, move the day-filter chip down
- **center:** Derive root name and ring geometry helpers
- **layout:** Widen vertical node spacing 25% on mobile
- **i18n:** Render day abbreviations in the active language
- **view:** Expose view levels on mobile via the Mindmap tab
- **view:** Shift Rocks/Pebbles one level deeper
- **mindmap:** Day filter prunes instead of dimming
- **quick-add:** Open the quick-add panel with the Q hotkey
- **mindmap:** Open comment dialog on comment icon click
- **offline:** Cache the Google profile photo in the service worker
- **offline:** Refresh the cached shell on a periodic background sync
- **offline:** Replace the plain-text 503 with a localized offline page
- **offline:** Precache the manifest icons in the service worker
- **sync:** Drain offline uploads from the service worker
- **offline:** Cache the landing and legal pages alongside the app shell
- **storage:** Request persistent storage for the shell cache and week data
- **offline:** Serve the app shell from a service worker cache

### Changed

- **week-nav:** Refit the mindmap view when the week changes
- **week-bar:** Split its buttons with the toolbar's 1px vertical rules
- **sync:** Replace toolbar avatar with a state-bearing cloud glyph
- **center:** Paint the root ring as the Stats donut's four-band split
- **center:** Thin the root's dark bands to a third, from 7.5 to 2.5
- **center:** Scale the root 1.25x so the avatar and completion ring read larger
- **week-bar:** Use Tabler menu-2 for the week-actions trigger
- **center:** Root node is the user, not the week
- **view-toggle:** Order tabs Mindmap, Agenda, Stats
- **view-levels:** Collapse the view-level row on desktop too
- **panels:** Delete legacy per-panel window chrome
- **panels:** Unify panel window chrome behind .app-panel
- **filter:** Drop the day-filter toast in favour of the chip
- **mindmap:** Share the today-dot label between both day menus
- **mindmap:** Drop the abbreviation column from the day-filter menu
- **mindmap:** Collapse the day rail into one button with a day menu
- **offline:** Consume the navigation preload in the service worker
- **quiet-refresh:** Collapse the duplicate version probes into one throttled check

### Fixed

- **transfer:** Clear unplanned flag on nodes moved to next week
- **center:** Give the root's + buttons a hit collar and a click slop for Stats
- **avatar:** Request profile photos at s320 so the monogram stops looking blurred
- **view-bar:** Let hover paint on inactive view-toggle tabs
- **week-bar:** Centre the label and match the actions icon to the arrows
- **help:** Dismiss help panel when switching views
- **views:** Persist stats section across refresh
- **panels:** Close 1px gap under toolbar in agenda and stats
- **filter:** Keep the day-filter chip inside narrow viewports
- **mindmap:** Build zigzag metrics from the filtered child set
- **mindmap:** Hold edit-teardown render until the pointer gesture ends
- **week:** Roll over the displayed week at midnight
- **analytics:** Skip Insights when offline or under Data Saver
- **sync:** Skip the avatar photo request when there is no link
- **quiet-refresh:** Honour Data Saver before refetching the document
- **quiet-refresh:** Defer the reload when the link can't carry the document
- **net:** Skip probe, poll and upload while the device has no link
- **net:** Give every network request an abort deadline

## [v2026.07.30] - 2026-07-30

### Added

- **stats:** Add 8- and 12-week ranges to the cumulative flow chart
- **layout:** Pack inbox items into a grid tray instead of a tall column
- **quick-add:** Preselect first branch when none saved
- **quick-add:** Keep panel open after submit with in-panel receipt and close button
- Support day-range interval syntax "(mo-we)" for scheduling
- Experimental Drive Changes API poll behind a flag (off by default)

### Fixed

- **stats:** Size cumulative flow axis labels to ~12.5px at any width
- **i18n:** Translate placeholders in applyTranslations
- **quick-add:** Order receipt strip FIFO, oldest first
- Keep Drive session on aborted or transient token refresh
- Keep stored branch colors; validate the synced colors file
- Cascade branch to descendants when rebinding a subtree across branches
- Repair remote reset, log silent GC, unconditional pre-push pull, poll discovery
- Undo reverses a transfer's own nodes instead of rewriting the next week
- Keep queued uploads, honour the import flag, and stop undo deleting peer work
- Serialize week-record writes and reconcile local-only weeks from IDB
- Propagate done/unplanned status up to branch nodes
- Sync branch left/right side across devices (refresh BRANCH_CONFIG on merge)
- Stop Drive poll re-downloading colors file with legacy-scheme contentHash

### Security

- Serve strict hashed CSP headers for landing pages
- Drop gapi client for plain fetch, close CSP to self + hashes
- Sunset the revoke_legacy relay on 2026-11-01
- Match localhost exactly in token proxy Secure-cookie check
- Add frame-ancestors, nosniff, referrer, HSTS headers in vercel.json
- Replace CSP unsafe-inline with per-script sha256 hashes, drop vercel.live
- Drop localStorage refresh-token fallbacks, purge and revoke lingering copies on load

## [v2026.06.24.1] - 2026-06-24

### Fixed

- Stop Drive poll re-downloading files with legacy-scheme contentHash

## [v2026.06.24] - 2026-06-24

### Added

- Live mirror-flip branch when dragged across root centerline

### Fixed

- Base colors sync identity on content hash, not raw JSON
- Stop Drive sync ping-pong by hashing canonical content, not raw JSON

## [v2026.06.22.1] - 2026-06-22

### Fixed

- Solid Stats/Agenda panel content so mindmap no longer bleeds through (light theme)

## [v2026.06.22] - 2026-06-22

### Added

- Agenda remembers manual task order; priority only sorts unordered groups
- Add Stats segment to view pill (S hotkey), drop stats close button
- Mark current week with a blue dot under the CFD axis label
- Morph CFD between lenses on click (from previous shape, no first-render anim)
- Add Total/per-branch lens switcher to the 4-week CFD
- Drop ambiguous CFD delta chip; rely on the visual trend
- Add gradient week guides and 50-point horizontal gridlines to CFD
- Replace 4-week sparkline with stacked-area cumulative flow diagram
- Lay out top stats sections as three equal-width columns, center the middle
- Hide unplanned stats and legends when week has no unplanned tasks
- Collapse deep nodes in Rocks/Pebbles and slide nodes + edges together

### Changed

- Remove the top-of-mindmap mini-stats box and its dead code
- Make Stats a real peer view so toolbar controls work correctly
- Group stats legend by category, fix Czech CFD title + week axis prefix

### Fixed

- Block browser pinch-zoom app-wide; only mindmap zooms (touch-action floor on body)
- Reflow immediately when opening node editor so new item doesn't overlap siblings
- Keep full bottom navigation visible while Stats panel is open
- Shrink mobile donut to 120px so two-column stats fit on 360px phones
- Move follow-through legend below branch bars to match Plan vs Reality
- Refresh next-week snapshot cache on Drive/peer merge to prevent undo tombstoning live nodes

## [v2026.06.14] - 2026-06-14

### Added

- Poll Drive for current week ±1 so adjacent weeks stay fresh
- Accept Czech "hned" as a (now) magic day token alias
- **undo:** Keep undo/redo on the current week instead of jumping to the action week
- **stats:** Move The Week timeline into a vertical 3rd column of the hero row
- **stats:** Add desktop-only Mon→Sun week timeline (T9)
- **stats:** Focus management + i18n parity test, hardening pass (T8)
- **stats:** Mobile-lean responsive layout, hide timeline on phones (T7)
- **stats:** Friendly empty + positive (no-unplanned) states (T6)
- **stats:** Add Effort & Balance section, share baseline helpers (T5)
- **stats:** Branch-tinted follow-through bars with status shading (T4)
- **stats:** Build Plan-vs-Reality donut + headline metrics (T3)
- **stats:** Add Stats panel shell, open from summary box (T2)
- **stats:** Extract shared computeWeekStats() helper feeding summary box (T1)
- **multitab:** Subtle toast cue when another tab updates the current week (T7)
- **multitab:** Guard in-flight edits explicitly via hasEditingNode in applyRemoteMerge (T4)
- **multitab:** Reconcile peer week-saved via CRDT merge, reconverge sender (T3)
- **multitab:** Add per-tab id and week-saved broadcast on save (T2)
- **multitab:** Drop proactive single-tab lock, keep overlay as DB-upgrade failsafe (T1)
- **agenda:** Make comment badge colored and clickable to open dialog

### Fixed

- Anchor node drag in world space so it tracks cursor during mid-drag zoom/pan
- Read settings blob from IndexedDB in syncColorsToDrive so theme/lang/colors sync to Drive
- Re-sync grandparent done status when moving nested last-undone child to next week
- Keep stats hero columns side by side on wider translations
- Route "tomorrow"-tagged items added on Sunday to next week
- Remove stray NUL byte in _applySnapshot sentinel
- **loadWeek:** Initialize tombstones/crdtVersion on inherited new weeks
- **move:** Give next-week branch/ancestor shells clean state
- **undo:** Only force-push the next week when it actually changed
- **sync:** Refresh next-week cache on loadAndRender; don't tombstone branches
- **sync:** Stop transfer/undo from duplicating & resurrecting nodes across weeks
- **stats:** No focus ring left on summary box after mouse-open + ESC close
- **stats:** Top-align Plan-vs-Reality & The Week columns, tighten gap, bump fonts
- **stats:** Order donut/bar segments done-first (planned, unplanned) then open
- **stats:** Make Plan-vs-Reality + branch bars priority-weighted to match the box
- **comment:** Keep top-right X visible on mobile so close stays reachable above keyboard
- **comment:** Allow comments on Inbox nodes

## [v2026.06.07] - 2026-06-07

### Added

- **agenda:** Schedule quantifier ticks to specific days
- **security:** Store Google refresh token in HttpOnly cookie instead of localStorage
- **comments:** ValidateAndRepair tolerance + merge tests (T6)
- **comments:** Display-only message indicator on agenda rows (T5)
- **comments:** Display-only message indicator on mind-map nodes (T4)
- **comments:** Dirty-check auto-save on dialog close (T3)
- **comments:** Context-menu Comment item + Help-style dialog shell (T2)
- **comments:** Add icon-message sprite + menu.comment i18n (T1)

### Fixed

- **transfer:** Keep manual nodes on top so transferred nodes don't jump to the top
- **transfer:** Merge into same-name bridge containers instead of duplicating
- **agenda:** Add edge auto-scroll to desktop drag reorder
- **agenda:** Done-section ticks show leaf number not cumulative position
- **agenda:** Route keyboard done/delete per-row so scheduled ticks don't cascade
- **agenda:** Count scheduled-tick rows in empty-screen guard
- **html:** Escape raw ampersand and resolve duplicate id="app"
- **security:** Harden untrusted-data paths (proto guard, token log, drive/import parse)
- **security:** Coerce tick-child labels to step number in validateAndRepair
- **security:** Prevent stored XSS in agenda tick pill (textContent not innerHTML)

## [v2026.05.27] - 2026-05-27

### Added

- **import:** Replace progress bar with icon-based week status toast
- **import:** Progressive import with background loading and progress toast
- **summary:** Close expanded drawer on click outside
- **agenda:** Tap (desktop) / long-press (mobile) label reveals full ancestor path

### Changed

- **i18n:** Remove 13 dead translation keys, add missing confirm.clearWeek
- **html:** Remove 10 unused SVG icon symbols and orphaned .wl-short/.wl-full CSS
- **js:** Remove 8 dead functions and their tests
- **css:** Remove 5 dead selectors (#legend, toolbar .legend-item/.legend-dot, .daily-log-footer-stat, .daily-log-time)
- **ui:** Unify dialog Cancel/Apply buttons to agenda-action-btn ghost style
- **css:** Remove dead .nav-btn styles (class unused in DOM)
- **quick-add:** Restyle branch pills to match standard buttons

### Fixed

- **sync:** Tombstone nodes on Clear Week so Drive sync does not restore them
- **transfer:** Preserve prev-week child order across sequential unfinished+reusable transfers
- **import:** Sort tick-children by tickIndex on load so counters display in order
- **quick-add:** Prevent input border flicker when selecting branch on desktop
- **import:** Reset agenda tab to today after importing data
- **agenda:** Reset active tab to today on day rollover when returning to tab
- **sync:** Prevent Drive sync from overriding undo/redo by force-pushing restored state
- **reschedule:** Preserve day-child done state when rescheduling sibling days
- **import:** Match toast-to-pill gap with pill-to-bottom spacing (12px)
- **import:** Reset zoom/pan to fit content after data import
- **seo:** Add missing canonical and robots meta tags to terms.html
- **html:** Restore icon-caret-up/down SVG symbols for week prev/next navigation
- **html:** Restore icon-circle-half-2 and icon-bolt-off SVG symbols
- **html:** Restore icon-repeat-off SVG symbol used by Disposable menu item
- **html:** Add missing icon-circle-dashed SVG symbol for Clear Day Filter menu item
- **ui:** Unify summary drawer collapsed height to 36px
- **ui:** Unify sync avatar button size to 36px
- **ui:** Unify sync button height to 36px
- **ui:** Unify button height to 36px across settings and confirm dialogs
- **quick-add:** Anchor panel to bottom and hide nav buttons while open
- **quick-add:** Use solid panel background matching settings
- **quick-add:** Use neutral gray focus border instead of accent blue
- **quick-add:** Suppress mobile keyboard autofill icons on input
- **mindmap:** Render drag handle on inbox nodes so they're draggable on touch
- **agenda:** Drop-target hit-tests row containing pointer (no dead zone over source)

## [v2026.05.20] - 2026-05-20

### Fixed

- **build:** Skip version substitution when VERCEL_ENV=development
- **sync:** Skip re-render on no-op Drive merge to stop zoom drift
- **agenda:** Unify mobile swipe and Done button into single action closure

## [v2026.05.18] - 2026-05-18

### Added

- **root:** Replace hidden nav carets with 3-brick week switcher
- **sync:** Wipe-on-logout option with env-settings preserved

### Changed

- **mindmap:** Cache subtree refs for hover, freeze hover during zoom
- **mindmap:** Skip updateSummary when inputs unchanged
- **mindmap:** Memoize getNodeSize and getNodeDepth per layout
- **mindmap:** GPU-composited pan/zoom on weak devices
- **mindmap:** Cache drag node refs + edge data at drag start
- **mindmap:** Cache measureText results
- **mindmap:** Drop SVG drop-shadow filters on weak devices
- **mindmap:** Coalesce per-keystroke render via rAF
- **agenda:** Lighter drag ghost, memoize overdue per render
- **agenda:** Drop overlay blur on low-end devices
- **agenda:** Skip offscreen rows via content-visibility
- **agenda:** Coalesce renders, surgical focus, cheap hover paint

### Fixed

- **agenda:** Fade partial-tick rows in Done section
- **agenda:** Hide row separator from drag image
- **agenda:** Defer Drive merge while dragging items
- **agenda:** Route pinch to mindmap on desktop, suppress on mobile

## [v2026.05.15] - 2026-05-15

### Added

- **view:** Refit mindmap on resize when visible behind agenda
- **view:** Recenter mindmap on window resize (debounced 200ms)
- **mobile:** Cache keyboard inset to pan optimistically on new-node edits
- **mindmap:** "+" add-child button uses done color when node is done
- **mindmap:** Bezier inherits done color when child is done

### Changed

- **cs:** Shorten "Poslední synchronizace" to "Aktualizace"

### Fixed

- **settings:** Show settings dropdown above Agenda view
- **mindmap:** Defer done propagation until new child commits
- **mobile:** Always center edited node, even when already visible
- **mobile:** Center new-node input above soft keyboard
- **release:** Create annotated tag so git push --follow-tags actually ships it

## [v2026.05.14] - 2026-05-14

### Added

- **release:** Add npm run release flow with git-cliff and auto GH Release
- **single-tab:** Add "Use here" button to take over from blocked tab
- **pwa:** Add Web App Manifest with high-res icons for Android home screen
- **reschedule menu:** Add "Now"/"Nyní" item that sets today and pins to top
- **agenda:** Enable swipe gestures on Done items (right=undone, left=menu)
- **agenda:** Record manual sort drag in undo/redo history
- **menu:** Mark today in Reschedule submenu with "(Today)/(Dnes)"
- **agenda:** Add (now)/(teď) magic selector — freezes to today and pins to top of agenda
- **days:** Add (today)/(dnes) and (tomorrow)/(zítra) magic selectors, frozen on edit

### Changed

- **reschedule menu:** Rename Clear-day action to Any / Kdykoli
- **reschedule menu:** Replace "(Today)" suffix with blue today dot
- **reschedule:** Extract pure computeDayReschedule helper; hotkey and context menu share state machine

### Fixed

- **pwa:** Set short_name to "Zenit Week" so Android launcher label matches full name
- **pwa:** Drop 512 maskable so Chrome picks 1024 for sharp splash on HiDPI
- **pwa:** Add 1024 icon sizes so HiDPI Android launchers stop softening the logo
- **pwa:** Regenerate corrected 512 PNGs and harden icon generator
- **pwa:** Use absolute icon URLs and allow self in img-src so manifest install works
- **pwa:** Switch manifest icons to static PNGs to enable Android WebAPK install
- **single-tab:** Wrap blocked overlay in surface card and break body to two lines
- **pwa:** Use current path for manifest start_url and scope
- **context menu:** Hide Reschedule on done activities
- **agenda:** Highlight swipe action icon green when past release threshold
- **agenda:** Restore desktop drag-reorder broken by mobile DnD fixes
- **agenda:** Suppress long-press context menu on mobile
- **agenda:** Restrict drag init to the grip handle, fixing mobile long-press drag
- **agenda:** Keep reorder drag alive when pointer leaves row horizontally
- **layout:** Place dropped non-zig siblings below zigzag block
- **summary:** Center status panel via inset+margin so numbers don't wrap on mobile
- **url:** Strip hash on current week; installed app ignores hash on cold start
- **sync:** Per-key LWW for agendaOrder; drop dead todoOrder
- **mindmap:** Measure text at effective pixel size so badge padding survives zoom-out
- **agenda:** Strip day groups from prefix labels so "(mo)" doesn't leak into parent crumb
- **reschedule:** Day-leaf context menu now replaces day instead of duplicating

## [v2026.05.13.2] - 2026-05-13

### Changed

- **cs:** Translate Mindmap pill label to "Mapa"

## [v2026.05.13.1] - 2026-05-13

### Added

- **i18n:** Localize Google Drive sync UI strings (toolbar + status messages)
- **i18n:** Localize default branch labels at week creation (cs → Práce/Rodina/Já)

### Fixed

- **cs:** Typo on homepage — "dáme" → "dáte" in stones/sand metaphor

## [v2026.05.13] - 2026-05-12

### Added

- **agenda:** Tick-parent menu — per-tick ops act on tick; rename/reschedule stay on parent
- **tick:** Allow unplanned/reusable/next-week/priority/delete in tick context menu
- **agenda:** One Done row per tick-today with cumulative position pill
- **tick:** Cap Nx at 100 — clamp higher counts silently
- **counter:** Replace mindmap counter pill with tick-children leaves

### Fixed

- **agenda:** Pending tick row previews next tick + "Done" button
- **tick:** Renumber surviving ticks after delete or move-next-week
- **agenda:** Keep tick/counter parents in pending after a tick-today, show Undone in Done section
- **agenda:** Show parent row when activity has tick-children + regular sub-tasks
- **tick:** Mode-switch from day-children to ticks when label loses day token
- **tick:** Preserve tick-children across parent rename
- **tick:** Block rename on tick-children (managed labels)
- **tick:** Apply h/2 corner radius to tick-children for circle shape
- **layout:** Zigzag treats only day-children as columns; non-day siblings stack standard
- **nodes:** New children inherit priority/reusable from parent on creation
- **og:** Square mindmap, balanced padding, strip center chrome

## [v2026.05.12.1] - 2026-05-12

### Fixed

- **csp:** Allow 'self' in script-src so Vercel WA snippet can load on /app

## [v2026.05.12] - 2026-05-12

### Added

- **analytics:** Wire Vercel Web Analytics into homepage (EN/CS) and app

## [v2026.05.11.1] - 2026-05-11

### Added

- **landing:** Split week transfer, add customizable branches card
- **landing:** Suggest preferred language via dismissable banner
- **i18n:** Detect browser language on first visit
- **landing:** Rename Counters to Magic selectors
- **landing:** Emphasize "they don't fit" as standalone paragraph
- **landing:** Replace solution pillars with glowing Tabler icons
- **landing:** Replace emoji feature icons with glowing Tabler icons
- **landing:** Rename Daily log to Agenda, promote to 2nd feature slot
- **og-image:** Swap mockup mindmap for real app rendering

### Changed

- **landing:** Drop left glass highlight on jars
- **landing:** Add vertical breathing room after ritual slogan
- **landing:** Polish CZ copy and EN ritual h2
- **landing:** Tighten Magic selectors copy
- **landing:** Reorder feature tiles
- **landing:** Rename footer CTA to "Open app"
- **landing:** Drop arrow from final CTA button
- **landing:** Remove arrow and center text in hero CTA
- **landing:** Shorten nav CTA on mobile
- **landing:** Polish "Problem" jar illustration
- **landing:** Use hero.svg in "The solution" section

### Fixed

- **landing:** Keep .ritual-note font at 13px
- **landing:** Unify section header styling across problem/solution/features
- **build:** Require owner/name shape on Vercel REPO_SLUG
- **build:** Resolve version via GitHub API when Vercel ships no .git

## [v2026.05.11] - 2026-05-11

### Added

- **quiet-refresh:** Auto-reload at next quiescent moment (Slice 4)
- **quiet-refresh:** Restore pan/zoom/view across reload (Slice 3)
- **quiet-refresh:** Probe asset ETag on foreground (log-only, Slice 2)
- **build:** Inject CalVer tag into HTML and show version in Help footer

### Fixed

- **build:** Trust VERCEL_GIT_COMMIT_REF for tag pushes, log fetch attempts
- **build:** Set outputDirectory and unshallow-fetch tags on Vercel

## [v2026.05.10] - 2026-05-10

### Added

- **help:** Add bottom "Close" pill on mobile, hide top-right X
- **i18n:** Add Czech homepage at /cs/ with hreflang alternates, CZ og-image, sitemap update
- **seo:** Add canonical, robots, sitemap, og-image, JSON-LD; prep FUNDING.yml

### Fixed

- **help:** Hide bottom pill bars on mobile when help is open
- **view:** Apply persisted view pre-paint to stop mindmap→agenda flash
- **summary:** Hide stats panel during initial load, drop unused emoji
- **summary:** Stop pointerdown propagation so stats toggle doesn't shift mindmap
- **magic:** Existing day-children pin node into multi-day mode
- **magic:** Skip counter creation when day-children already exist
- **sync:** Drop stale child links in CRDT merge so rebound inbox nodes don't double-bind

## [v2026.05.08] - 2026-05-08

### Added

- Agenda groups sort by priority and reorder live on change
- Rebind hit-testing uses rect overlap, max-area wins
- Highlight drop target during node drag
- Edge autoscroll while dragging mind-map nodes
- Drag handle on nodes for touch-friendly move/rebind
- Dynamic zoom range — 100% always fits whole map

## [v2026.05.07] - 2026-05-07

### Added

- Scope agenda drag-drop to source group; snap to start/end on foreign drop
- Edge autoscroll for grip-drag; remove long-press drag/menu
- Show item count badge on Agenda section dividers
- Add Scheduled divider to first Agenda group
- Scale vertical gaps by priority in mind map layout
- Inherit day annotation from closest annotated ancestor in Agenda
- Prefix single-word agenda labels with parent name

### Changed

- Always show {parent} · {leaf} in agenda labels
- Use getAgendaNodeLabel for Any day group items
- Group Overdue Agenda items by day with day-name dividers
- Replace OAuth popup with full-page redirect for Safari support
- Unify magic-label logic between commitEdit and inbox quick-add
- Skip mindmap render when canvas is hidden in mobile agenda view

### Fixed

- Separate · separator into own span to preserve spacing in agenda labels
- Keep counter pill visible on completed Agenda items
- Strip Nx from label when auto-creating counter
- Don't auto-create counter for single-day Nx activities
- Append day hint to children of annotated parents in Overdue
- Show day hint on multi-day overdue items in Agenda
- Prevent orphan nodes from Drive-sync race during chained ENTER/TAB
- Refresh Agenda after quick-add so new inbox nodes appear immediately
- Include all unscheduled activities in Agenda Any-day section

## [v2026.05.06] - 2026-05-06

### Added

- Show + icon on hover target during drag for rebind hint
- Dim dragged node subtree to 40% opacity during drag
- Add button-like hover on collapsed status panel inner area
- Show inbox nodes in Agenda — Any Day or day tab based on label tokens
- Hide add-child button and menu item on inbox nodes
- Blur and dim canvas behind quick-add panel like Help overlay
- Clear inbox flag when dragging node to a permanent parent
- Render inbox nodes muted, without bezier, sorted last in layout
- Add quick-add panel HTML, CSS, JS and inbox node creation
- Replace settings FAB with pill FAB (settings | add)
- Show virtual done on parent nodes when all day-filter matches are done

### Changed

- Reduce unselected branch pill opacity to 30%
- Apply 30% smaller pill size on mobile too, unify base styles
- Scale down quick-add branch pills 30% on desktop
- Style quick-add branch pills to match mindmap branch node visuals
- Replace branch dropdown with inline pill row in quick-add
- Remove submit button from quick-add, rely on Enter key

### Fixed

- Strip _editing nodes before async IDB write to prevent stray empty nodes
- Zigzag layout when auto layout is disabled
- Zigzag day-leaf layout respects priority and depth scaling
- Remove ratio-bar margin so bottom spacing matches top
- Keep status panel padding constant on expand
- Align summary header height with panel inner area
- Fit mindmap at init regardless of boot view
- Remove default focus outline on settings and add buttons
- Draw bezier to inbox day-leaves and apply matching opacity
- Block pinch-to-zoom on viewport while quick-add panel is open

## [v2026.05.05] - 2026-05-05

### Added

- Show partially ticked counters in Daily Log with active +1 button
- Hide view-toggle labels on mobile, match button size to undo/redo pill
- Reorganize UI corners — badge on avatar, settings FAB, undo/redo pill
- Replace long-press rename with long-press drag-to-reorder on mobile agenda items
- Close Agenda panel with ESC on desktop

### Fixed

- Enforce strict day filtering for multi-day selectors
- Restore parent-child labels in Agenda and expand sub-tasks of annotated nodes
- Use inset box-shadow on agenda-item so drop indicator is visible at first position
- Guard week-nav-btn clicks from triggering center-node pan in pointerdown
- Logo click navigates to current week and clears day filter on both views

## [v2026.05.04] - 2026-05-03

### Added

- Implement Google Drive sync tests and fix un-awaited merge operation
- Implement single-tab enforcement and storage quota handling
- Implement IndexedDB storage and localStorage migration
- Show reusable icon badge on agenda items — refreshes immediately on toggle
- Replace long-press context menu with rename on mobile agenda — swipe left handles context menu
- Hide done/undone/+1 buttons on mobile agenda — swipe handles those actions, label uses the freed space
- Agenda swipe gestures with visual feedback — item slides to reveal done/undone or menu action, highlights on swipe, stays highlighted while context menu is open
- Add swipe gesture visual feedback to agenda items — item slides to reveal done/undone (green/amber) on right swipe and menu icon (indigo) on left swipe, with 20% threshold and snap-back
- Show floating ghost row while touch-dragging agenda item on mobile
- Touch-drag sorting via agenda grip handle on mobile
- Add manual drag-and-drop sorting per group in agenda view
- Implement mindmap overdue filter (hotkey 0)
- Vertical zig-zag with constant vertical spacing and dynamic horizontal column stagger
- Implement hexagonal zig-zag packing for multi-day nodes to ensure uniform spacing
- Reschedule context menu matches hotkey logic + fix Any day showing all unscheduled activities
- Restyle settings Import/Export buttons to match Help button style, Import first
- Restyle agenda Done/Undone/+1 buttons to match Help button visual style
- Highlight agenda items on mouse hover using the same focused style as keyboard navigation
- Add left/right arrow key navigation between day tabs in activity panel
- Add Clear Day Filter escape hatch to center-node context menu (Track C step 4)
- Add node-assignment hotkeys 1–7/8 — radio for single-day, checkbox for multi-day children (Track C step 3)
- Add day-filter engine — activeDayFilter state, getDayFilterOpacity(), applyFilters() replacing applyViewLevel() (Track C step 1)

### Changed

- Make agenda drag handle always visible
- Use full day names and consistent prefix in filter toast
- Move toast notification above view toggle bar
- Add accent dot below today's day tab in activity panel
- Set activity panel to 5px gap from toolbar and viewport bottom on desktop
- Set help panel to 5px gap from toolbar and viewport bottom on desktop
- Align agenda item focus highlight color with help button hover (--bg-hover)
- Center agenda tabs on desktop
- Redesign agenda tabs as pills to match view toggle style
- Add vertical separators between agenda tabs
- Apply precise responsive bottom padding to agenda and help panels
- Implement inner-inset active/hover background style for global buttons
- Unify action button styles and dimensions with help button
- Restore help button visibility and position on mobile
- Implement toggle functionality for help button
- Fix help panel horizontal centering on desktop
- Implement responsive transition for help panel matching agenda view
- Add backdrop blur to agenda desktop view and ensure toggle visibility
- Center agenda desktop panel and match help panel width
- Transform agenda view into a responsive side-panel on desktop
- Add active state to global settings button when dropdown is open
- Add active state to help button when help panel is open
- Ensure toolbar and settings dropdown overlap the summary panel
- Apply glass effect to view level bar for consistency
- Synchronize glass effect across all floating UI panels
- Style help button to match the floating switch aesthetic
- Reposition help button and tighten global panel spacing
- Remove blue focus outline from view toggle buttons
- Precisely match view toggle design to view level switch aesthetic
- Refactor view toggle into a floating pill-style switch
- Move summary panel to top of canvas and expand downwards
- Add icons to view toggle buttons; rotate mindmap icon 90deg CCW
- Change Mindmap hotkey from ESC to M; keep A for Agenda
- Swap order of Mindmap and Agenda buttons in bottom bar

### Fixed

- Resolve test failures in transferReusable, getAnyDayItems, and zig-zag layout
- Hide Add Activity in context menu when opened from agenda view
- Refresh agenda after moving item to next week so it disappears immediately
- Close context menu when swipe gesture is confirmed
- Align max swipe distance to action area width (25%) so icon is centered at max position
- Reduce agenda section divider margins so adjacent items match the height of regular items
- Restore agenda item height on mobile — min-height 48px matches desktop button-defined height
- Restore agenda item dividers lost when wrapping items in swipe wrapper — move border-bottom to wrapper
- Remove background colors from swipe action areas — show icons only
- Hide swipe action areas when not actively swiping — visibility:hidden by default, revealed only via is-swiping class set on touchmove confirmation
- Preserve full branch path in mindmap day filter
- Enable manual positioning and reordering for day-child nodes in manual mode
- Split import try/catch, stop Drive poll before re-init to prevent reset-token race wipe
- Reset agenda to today's tab when logo is clicked while in agenda view
- Remove redundant plus icon from +1 counter button in activity panel
- Keyboard navigation in agenda list — stable focus, proper scroll, no wrap
- Replace blue outline on focused agenda item with full-width muted background highlight
- Restore agenda context menu visibility by increasing z-index
- Agenda panel mobile layout overflow and active tab styling
- Instantly refresh agenda view on language change
- Drop shiftKey guard on canvas day-filter hotkeys to support Czech and other layouts where digits require Shift (Track C step 2)



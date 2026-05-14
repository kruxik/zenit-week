# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [CalVer](https://calver.org/) — `vYYYY.MM.DD[.N]`.

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



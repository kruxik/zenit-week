# Implementation Plan: UI Panels & Overlays Tests

## Overview
While the core logic of Zenit Week is heavily tested, the specialized floating UI panels and overlays—such as the Daily Log, Agenda View, Settings, and custom dialogs—lack comprehensive test coverage. These components manage complex data-to-DOM mappings, state-driven rendering, and localization. This plan introduces tests for these components, utilizing Playwright for end-to-end interactions to ensure DOM elements reflect internal state accurately.

## Architecture Decisions
- **Framework:** Playwright (integrated alongside SVG Visual Integrity and User Interaction tests).
- **Scope:** Verify the layout, rendering, and interaction logic within the application's floating panels, sidebars, and overlays.
- **Coverage Target:** Daily Log grouping, Agenda view sorting, Theme/Language switching side-effects, and custom Modal dialogs.

## Task List

### Phase 1: Daily Log & Todo Panels
**Description:** Verify the logic that aggregates and displays daily progress and upcoming tasks.
**Acceptance criteria:**
- **Daily Log:** Verify that completing nodes (or incrementing counters) correctly adds them to the daily log with accurate timestamp groupings.
- **Color Indicators:** Ensure branch colors correctly map to the indicator dots in the log entries.
- **Todo Panel:** Verify the sidebar accurately lists all incomplete activity nodes across the current week.
- **Interaction:** Clicking an item in the Todo panel navigates/focuses the map correctly.

### Phase 2: Agenda View Sorting & Rendering
**Description:** Test the specific rendering rules and logic for the Agenda (day-filtered) view.
**Acceptance criteria:**
- **Date Sorting:** Ensure tasks are grouped and sorted correctly by their assigned day (Monday–Sunday) and overdue status.
- **Overdue Highlighting:** Verify that tasks from previous days are visually distinct (e.g., highlighted as overdue) when viewing the current day.
- **Rescheduling:** Test the drag-and-drop or context menu actions to move a task from one day to another within the Agenda view.

### Phase 3: Theme & Localization (i18n) Switching
**Description:** Ensure changing global settings correctly updates the DOM in real-time.
**Acceptance criteria:**
- **Theme:** Toggling between Light and Dark mode correctly updates the `data-theme` attribute on the `<html>` element and updates the CSS variables without requiring a reload.
- **Language:** Switching between supported languages (e.g., English, Czech) instantly updates all `[data-i18n]` elements in the DOM via the `applyTranslations()` function.

### Phase 4: Modals & Custom Dialogs
**Description:** Verify that application-blocking overlays and custom confirm dialogs function safely.
**Acceptance criteria:**
- **Confirm Dialog:** Trigger an action requiring confirmation (e.g., deleting a branch). Verify the custom `#app-confirm-overlay` appears and traps focus.
- **Dialog Actions:** Verify that clicking "Cancel" dismisses the modal without executing the action, and clicking "Confirm" executes the action.
- **Help Panel:** Ensure opening the Help overlay renders the shortcut list correctly and can be closed via `Escape` or clicking the backdrop.

## Verification
- All tests pass when running `npx playwright test --project=chromium`.
- Manual verification of localization and theme switching confirms instantaneous DOM updates without flickering.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Timezone dependencies in Agenda tests | High | Use Playwright's `timezoneId` configuration to force a specific timezone during test execution, ensuring predictable day boundaries. |
| Overlapping overlays causing test flakes | Medium | Use strict Playwright assertions (e.g., `toBeVisible()`, `not.toBeVisible()`) to verify the z-index and visibility of active overlays before interacting with them. |

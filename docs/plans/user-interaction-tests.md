# Implementation Plan: User Interaction & Event Handling Tests

## Overview
Zenit Week relies heavily on keyboard shortcuts, pointer events, and custom context menus for efficient navigation and editing. While the core state updates (e.g., CRDT merge) are covered by unit tests, the mapping of user input (DOM events) to these state changes is currently untested. This plan introduces Playwright E2E tests to verify that keyboard shortcuts, pointer interactions, and context menus correctly trigger the expected application behaviors.

## Architecture Decisions
- **Framework:** Playwright (sharing the setup with SVG Visual Integrity tests).
- **Scope:** Focus on simulating exact user inputs (`page.keyboard.press`, `page.mouse.click`, etc.) and verifying the resulting DOM state or visual feedback, rather than unit-testing the event listener callbacks directly.
- **Coverage Target:** Keyboard shortcuts, mouse/pointer selection, context menu logic, and inline editing workflows.

## Task List

### Phase 1: Keyboard Shortcuts Navigation & Editing
**Description:** Verify that all primary keyboard shortcuts function correctly when a node is hovered or selected.
**Acceptance criteria:**
- **Add Child (`Tab`):** Pressing `Tab` on a hovered node creates a new child node and opens the inline editor.
- **Rename (`Enter`):** Pressing `Enter` on a hovered node opens the inline editor with the current text.
- **Delete (`Backspace` / `Delete`):** Pressing `Backspace` deletes the hovered node (and prevents deletion of the last branch).
- **Status Toggles (`D`, `U`):** Pressing `D` toggles the "Done" state; pressing `U` toggles the "Unplanned" state.
- **Undo/Redo (`Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z`):** Modifying a node and using undo/redo keyboard combos correctly reverts/restores the state.

### Phase 2: Inline Editing Workflow
**Description:** Test the lifecycle of the inline input field (`#inline-input`).
**Acceptance criteria:**
- Activating edit mode correctly positions the `#inline-input` over the SVG node.
- Pressing `Enter` commits the text and closes the input.
- Pressing `Escape` cancels the edit and restores the previous text.
- Clicking outside the input (blur) commits the text.

### Phase 3: Context Menu Logic
**Description:** Verify the custom context menu appears and functions correctly based on the target node.
**Acceptance criteria:**
- **Trigger:** Right-clicking (or long-pressing) a node opens the `#context-menu` at the correct cursor coordinates.
- **Context Awareness:** The menu hides options that don't apply to the selected node (e.g., hiding "Delete" on the root node or last remaining branch).
- **Actions:** Clicking menu options (e.g., "Add child", "Reschedule") correctly triggers the corresponding application function.
- **Dismissal:** Clicking anywhere outside the context menu or pressing `Escape` closes it.

### Phase 4: UI Panels & Toolbar Interactions
**Description:** Test interactions with the floating panels (Summary, Todo, Agenda, Settings) and the main toolbar.
**Acceptance criteria:**
- Clicking toolbar icons correctly toggles the visibility of the respective side panels.
- Pressing `Escape` closes open panels and overlays (e.g., Help overlay, Settings panel).
- Interacting with panel-specific elements (e.g., checking a checkbox in the Todo panel) correctly updates the main SVG view.

## Verification
- All tests pass when running `npx playwright test --project=chromium`.
- The tests successfully simulate both Windows (`Ctrl`) and macOS (`Meta/Cmd`) modifier keys for Undo/Redo logic.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Hover states are difficult to simulate | Medium | Ensure Playwright's `page.hover()` accurately triggers the internal DOM events required to set the "hovered node" state before dispatching keyboard events. |
| Timing issues with inline input positioning | Low | Use Playwright's auto-waiting `expect(locator).toBeVisible()` to ensure the input is fully rendered before typing. |

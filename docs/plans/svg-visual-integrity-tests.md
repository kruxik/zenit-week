# Implementation Plan: SVG Visual Integrity Tests

## Overview
Zenit Week relies entirely on inline SVG for its mind map visualization. Critical visual features like node placement, bezier curve connections, gradient fills, and text measurement cannot be accurately verified in a Node.js test environment. This plan introduces **Playwright** for End-to-End (E2E) and Visual Regression testing to guarantee the structural and visual integrity of the app's rendering layer.

## Architecture Decisions
- **Framework:** Playwright. It provides real browser engines (Chromium, WebKit, Firefox) capable of exact SVG bounding box calculations and visual snapshot comparisons.
- **Visual Regression:** Use Playwright's `expect(page).toHaveScreenshot()` for full map visual validation across light/dark themes.
- **Test Server:** Use a lightweight static server (e.g., `npx serve` or Playwright's built-in web server config) to serve `zenit-week.html` during tests.

## Task List

### Phase 1: E2E Foundation & Playwright Setup
**Description:** Install Playwright, configure the test runner, and create a foundational test to verify the app boots and renders the basic SVG structure.
**Acceptance criteria:**
- `playwright` and `@playwright/test` are added to `devDependencies`.
- `playwright.config.js` is created, configured to serve `zenit-week.html` statically.
- A smoke test verifies that the `<svg id="main-svg">` and core groups (`#map-root`) exist in the DOM upon load.
- Ensure the Vitest unit tests (`npm test`) remain unaffected.

### Phase 2: Structural & Layout Testing
**Description:** Write tests that interrogate the DOM to verify correct radial layout calculation and scaling.
**Acceptance criteria:**
- Test that default branch nodes (work, family, me) are positioned correctly relative to the center root.
- Test that node size dynamically changes based on priority (e.g., critical priority nodes have larger bounding boxes than normal priority nodes).
- Test that adding a new child node correctly updates the `d` attribute of the connecting bezier curve (`<path>`).

### Phase 3: Interaction & Event Testing (Drag & Drop)
**Description:** Automate mouse/pointer events to verify SVG panning, zooming, and drag-and-drop mechanics.
**Acceptance criteria:**
- Test canvas panning: dragging the background changes the `transform` attribute of `#map-root`.
- Test zooming: simulating mouse wheel events correctly updates the scale factor.
- Test node repositioning: dragging a branch or activity node updates its coordinates and redraws connections.

### Phase 4: Visual Regression Testing
**Description:** Implement pixel-perfect snapshot testing for critical visual states.
**Acceptance criteria:**
- Snapshot test for the default layout in Light Mode.
- Snapshot test for the default layout in Dark Mode.
- Snapshot test verifying that the "Done" state cascades correctly (opacity/strikethrough changes) down a node branch.

## Verification
- All tests pass when running `npx playwright test`.
- Playwright HTML report generates successfully, specifically showing diffs for any failed snapshot tests.
- CI workflow is updated (if applicable) to run Playwright tests and store snapshot artifacts.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Flaky snapshot tests due to anti-aliasing | High | Use Playwright's `maxDiffPixelRatio` and `maxDiffPixels` thresholds. Ensure animations/transitions are disabled during E2E runs if necessary. |
| Test suite execution time | Medium | Playwright runs in parallel by default. Scope visual regression tests only to the most critical paths. |

# Week Planner - Gemini Instructions

## Project Overview
A visually rich, single-file web application for planning weeks using a Mind Map interface. It uses SVG for rendering and `localStorage` for data persistence.

## Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, and JavaScript (ES6+).
- **Graphics**: Inline SVG for the mind map visualization.
- **State Management**: Local state object `weekData` persisted to `localStorage`.
- **Icons/Assets**: Native Unicode characters and CSS-based shapes.

## Key Files
- `week-planner.html`: The entire application (HTML, CSS, and JS).

## Coding Standards & Conventions
- **Single File Policy**: Maintain the entire application within `week-planner.html` to ensure portability and simplicity.
- **JavaScript**:
  - Use `'use strict';`.
  - Prefer `const` and `let` over `var`.
  - Use camelCase for function and variable names.
  - Manipulate SVG elements using `document.createElementNS('http://www.w3.org/2000/svg', tag)`.
- **CSS**:
  - Use Flexbox for layout.
  - Follow kebab-case for IDs and classes.
  - Keep styles scoped within the `<style>` tag in the header.
- **Data Model**:
  - Tasks are "nodes" with a recursive parent-child relationship.
  - Weeks are identified by ISO week keys (e.g., `2026-14`).

## Workflows
- **Running**: Open `week-planner.html` directly in any modern web browser.
- **Development**: Edit `week-planner.html` and refresh the browser.
- **Testing**: Manual verification in the browser. Ensure drag-and-drop, zooming, and data persistence work across refreshes.

## UI/UX Guidelines
- **Visual Style**: Modern, clean interface with rounded corners, soft shadows, and a professional color palette.
- **Interactions**: Support both mouse (click/drag) and keyboard (Enter to commit, Esc to cancel) where applicable.
- **Feedback**: Provide visual cues for hover states and active operations (e.g., "panning" cursor).

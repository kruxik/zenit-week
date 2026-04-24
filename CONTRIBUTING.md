# Contributing to Zenit Week

Thank you for your interest in contributing to Zenit Week! This project aims to stay simple, portable, and visually rich.

## 🚀 How to Run

1.  Clone the repository.
2.  Open `zenit-week.html` in any modern web browser — no server required.
3.  To run the test suite and HTML validator, install dev dependencies first:
    ```sh
    npm install
    npm test            # runs vitest
    npm run validate    # runs html-validate
    ```

## 📜 Principles

- **Single-File Policy:** The entire application must remain within `zenit-week.html`. This ensures the tool remains a "portable utility" that anyone can download and use instantly.
- **Vanilla Only:** No external frameworks (React, Vue, Tailwind, etc.). Use standard HTML5, CSS3, and ES6+ JavaScript.
- **Privacy:** Zenit Week has no servers and stores nothing itself. User data must stay on the user's device (localStorage) or in their own Google Drive — never on our infrastructure.

## 🛠️ Development Workflow

1.  **Edit:** Make your changes directly in `zenit-week.html`.
2.  **Test:** Refresh your browser and manually verify:
    - Drag-and-drop works.
    - Zoom and pan are smooth.
    - Data persists after a refresh.
    - No console errors.

    If you touched core data logic, also run the automated suite:
    ```sh
    npm test
    npm run validate
    ```
3.  **Code Style:**
    - Use `'use strict';`.
    - Prefer `const` and `let` over `var`.
    - Follow camelCase for JS functions and kebab-case for CSS classes.
    - Keep CSS in the `<style>` tag and JS in the `<script>` tag.

## 📥 Submitting Changes

1.  Create a branch for your feature or bug fix.
2.  Ensure your code follows the principles above.
3.  Submit a Pull Request with a clear description of your changes and why they are needed.

## 🧪 Testing

If you're making changes to the core data logic (week calculation, data repair, etc.), please check if there are existing tests in the `tests/` directory and add new ones if appropriate.

## 🐞 Reporting Issues

Please use the GitHub Issue tracker to report bugs or suggest features. Include your browser and OS version when reporting bugs.

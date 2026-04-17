# Zenit Week

A visually rich, single-file mind-map week planner that runs entirely in your browser. No server, no database, no complex setup—just one HTML file.

<!-- add screenshot here -->

## 🚀 Quick Start

1. Download `zenit-week.html`.
2. Open it in any modern web browser (Chrome, Firefox, Safari, Edge).
3. Start planning! Your data is automatically saved to your browser's `localStorage`.

## ✨ Features

- **Mind Map Interface:** Visualize your week as a branching tree of activities.
- **Customizable Branches:** Start with **Work**, **Family**, and **Me**; add or delete branches, and change their colors with the built-in color picker.
- **Priority Levels:** Mark tasks as Normal, High, or Critical — priority scales visual layout spacing and cascades to child nodes.
- **Dynamic Counters:** Add `Nx` to any task name (e.g., "Pushups 10x") to track progress with a clickable counter.
- **Reusable Tasks:** Mark tasks as Reusable and carry them forward each week with counters reset.
- **Drag & Drop:** Easily reorder tasks or rebind them to different parent nodes.
- **Cross-Week Transfer:** Move unfinished tasks from the previous week to the current one; or transfer only Reusable tasks.
- **Daily Log:** View a summary of completed and ticked activities for the day, with timestamps.
- **Todo Panel:** Quick sidebar listing all incomplete tasks across the week.
- **Dark Mode:** Full light/dark theme with automatic detection of system preference.
- **Undo/Redo:** Full history support with 100 levels of undo.
- **Privacy First:** Your data never leaves your computer; it stays in your browser's local storage.

## ⌨️ Keyboard Shortcuts

Hover over a node and use these hotkeys for rapid editing:

| Action | Shortcut |
| :--- | :--- |
| **Rename** | `Enter` |
| **Add Child** | `Tab` |
| **Delete** | `Backspace` / `Delete` |
| **Toggle Done** | `D` |
| **Toggle Unplanned** | `U` |
| **Quick Options** | `Right Click` |
| **Undo** | `Ctrl/⌘ + Z` |
| **Redo** | `Ctrl/⌘ + Shift + Z` or `Ctrl/⌘ + Y` |
| **Close Panel / Menu** | `Esc` |

*Hover over a node to activate node-specific shortcuts.*

## 🛠️ Technical Details

- **Architecture:** Single-file application (HTML5, CSS3, Vanilla JS).
- **Graphics:** Inline SVG for smooth, scalable mind map rendering.
- **Storage:** Uses `localStorage` with keys formatted as `zenit-week-YYYY-WW`.
- **Requirements:** Any modern browser with ES6+ support.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

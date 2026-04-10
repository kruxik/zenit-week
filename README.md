# Week Planner

A visually rich, single-file mind-map week planner that runs entirely in your browser. No server, no database, no complex setup—just one HTML file.

<!-- add screenshot here -->

## 🚀 Quick Start

1. Download `week-planner.html`.
2. Open it in any modern web browser (Chrome, Firefox, Safari, Edge).
3. Start planning! Your data is automatically saved to your browser's `localStorage`.

## ✨ Features

- **Mind Map Interface:** Visualize your week as a branching tree of activities.
- **Categorized Branches:** Organize tasks into **Work**, **Family**, and **Me** with customizable colors.
- **Dynamic Counters:** Add `Nx` to any task name (e.g., "Pushups 10x") to track progress with a clickable counter.
- **Drag & Drop:** Easily reorder tasks or rebind them to different parent nodes.
- **Cross-Week Transfer:** Effortlessly move unfinished tasks from the previous week to the current one.
- **Daily Log:** View a summary of your completed activities for the day.
- **Undo/Redo:** Full history support with 100 levels of undo.
- **Privacy First:** Your data never leaves your computer; it stays in your browser's local storage.

## ⌨️ Keyboard Shortcuts

Hover over a node and use these hotkeys for rapid editing:

| Action | Shortcut |
| :--- | :--- |
| **Rename** | `Enter` |
| **Add Child** | `Tab` |
| **Delete** | `Backspace` |
| **Toggle Done** | `D` |
| **Toggle Unplanned** | `U` |
| **Quick Options** | `Right Click` |
| **Undo** | `Ctrl/⌘ + Z` |
| **Redo** | `Ctrl/⌘ + Shift/⇧ + Z` |

*Note: Navigation shortcuts automatically adapt to your Operating System.*

## 🛠️ Technical Details

- **Architecture:** Single-file application (HTML5, CSS3, Vanilla JS).
- **Graphics:** Inline SVG for smooth, scalable mind map rendering.
- **Storage:** Uses `localStorage` with keys formatted as `week-planner-YYYY-WW`.
- **Requirements:** Any modern browser with ES6+ support.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

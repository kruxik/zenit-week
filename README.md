# Zenit Week

A visually rich, single-file mind-map week planner that runs entirely in your browser. No server, no database, no complex setup—just one HTML file.

## 🚀 Quick Start

**Online:** Open [zenitweek.com](https://zenitweek.com/) and start immediately — nothing to install.

**Offline:** Download `zenit-week.html` and open it in any modern web browser (Chrome, Firefox, Safari, Edge). Your data is automatically saved to your browser's `localStorage`.

## ✨ Features

- **Mind Map Interface:** Visualize your week as a branching tree of activities.
- **Customizable Branches:** Start with **Work**, **Family**, and **Me**; add or delete branches, and change their colors with the built-in color picker.
- **Priority Levels:** Mark tasks as Normal, High, or Critical — priority scales visual layout spacing and cascades to child nodes.
- **Dynamic Counters:** Add `Nx` to any task name (e.g., "Pushups 10x") to track progress with a clickable counter.
- **Day Indicators:** Add `(mo)`, `(we, fr)`, or `(daily)` to any activity name to schedule it for specific weekdays in the daily list. Multiple days work with spaces or commas: `(mo, we, fr)`.
- **View Levels:** Switch between **Sand** (all nodes), **Pebbles** (hide deep sub-tasks), and **Rocks** (main branches only) to control visual depth. Swipe on mobile to cycle levels.
- **Reusable Tasks:** Mark tasks as Reusable and carry them forward each week with counters reset.
- **Drag & Drop:** Easily reorder tasks or rebind them to different parent nodes.
- **Cross-Week Transfer:** Move all unfinished tasks from the previous week; or transfer only Reusable tasks; or move a single node (with its subtree) to the next week.
- **Effort Baseline:** Set a weekly activity count that represents a safe load — the summary panel warns when you're over it.
- **Daily Log:** View a summary of completed and ticked activities for the day, with timestamps.
- **Todo Panel:** Quick sidebar listing all incomplete tasks across the week.
- **Export / Import:** Back up all your weeks to a JSON file and restore them on any device from Settings.
- **Dark Mode:** Full light/dark theme with automatic detection of system preference.
- **Undo/Redo:** Full history support with 100 levels of undo.
- **Google Drive Sync:** Optionally sign in with Google to sync your data across devices — stored only in your own Google Drive.
- **Internationalization:** UI available in English and Czech; language selector in Settings, persisted across devices via Drive sync.
- **Privacy First:** Zenit Week has no servers and stores nothing itself. Your data lives on your device (localStorage) or in your own Google Drive — it never touches our infrastructure.

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

**Navigation:** Drag the background to pan. Scroll or pinch to zoom.

## 🛠️ Technical Details

- **Architecture:** Single-file application (HTML5, CSS3, Vanilla JS) served at `/app`.
- **Graphics:** Inline SVG for smooth, scalable mind map rendering.
- **Storage:** Uses `localStorage` with keys formatted as `zenit-week-YYYY-WW`.
- **Requirements:** Any modern browser with ES6+ support.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Added `LICENSE` (MIT).
- Added `README.md` with features and hotkeys.
- Optimized performance by removing redundant `render()` on typing.
- Optimized performance by using a `Map` for node lookups.
- Optimized performance by caching SVG linear gradients.
- Improved data integrity by repairing corrupted data and stripping `_editing` flags on load.
- Improved debuggability by adding warnings to `localStorage` failure points.
- Fixed `window resize` resetting the view prematurely.
- Improved ID generation using `crypto.randomUUID()`.
- Fixed branch legend colors being hardcoded.
- Added infrastructure: `.gitignore`, `CONTRIBUTING.md`, `package.json`.

## [1.0.0] - 2026-04-10

### Added
- Mind map interface for weekly planning.
- Branch categories: Work, Family, Me.
- Interactive progress counters (Nx).
- Drag-and-drop node organization and reordering.
- Cross-week unfinished task transfer.
- Daily log panel for activity summaries.
- Local data persistence via `localStorage`.
- Support for undo (100 levels) and redo.
- Dark mode support and modern UI.

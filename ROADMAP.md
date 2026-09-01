# Scout roadmap

## M1 — Daily-driver filesystem

- [x] Real directory listing
- [x] Back/forward navigation
- [x] Copy/cut/paste
- [x] Duplicate
- [x] Rename
- [x] Native trash
- [x] Filesystem watcher with debounced active-directory refresh
- [x] Hidden files
- [x] Cross-platform pointer drag/drop between folders
- [x] Native OS file drops copy into the active folder
- [x] Proper keyboard selection
- [x] Context menus
- [x] Tabs
- [x] Open files with the system default application
- [x] Create folders

M1's implementation baseline is complete. Platform QA and behavior hardening continue as Scout is exercised on macOS, Windows, and Linux.

## M2 — Previews

- [x] Image thumbnails in directory views
- [x] Image Quick Look with EXIF metadata
- [x] PDF Quick Look
- [x] Text/code Quick Look
- [x] Rendered Markdown Quick Look
- [x] Audio/video Quick Look
- [x] Folder-content Quick Look
- [x] ZIP archive Quick Look without extraction

M2's implementation baseline is complete. Additional archive formats and richer media controls can be layered onto the same preview system.

## M3 — Power navigation

- [x] Persistent SQLite-backed fuzzy index
- [x] Usage, recency, and path-aware ranking
- [x] Bounded persistent content search
- [x] Saved searches
- [x] 2–4 panes
- [x] Linked/synced pane navigation
- [x] Persistent named workspaces

M3's implementation baseline is complete.

## M4 — Utilities

- [x] Capability-gated FFmpeg media conversion
- [x] Native image conversion/resize/optimization
- [x] Capability-gated Pandoc and LibreOffice document conversion
- [x] Native PDF tools: merge, extract, split, delete, reorder, rotate, compress, and metadata removal
- [x] ZIP create/extract plus read-only archive preview
- [x] Collision-safe batch rename
- [x] Exact duplicate detection
- [x] Local visually similar-photo search
- [x] Disk/folder size treemap
- [x] SHA-256 checksums
- [x] Persistent Portal shelf
- [x] Open Terminal Here

M4's implementation baseline is complete. External converter features are enabled only when their corresponding local tools are installed.

## M5 — Automation and operations

- [ ] Hazel-style rules
- [ ] File triggers
- [ ] Move/copy/rename/tag/convert/optimize/archive/script actions
- [x] Shared operation queue core with queued/running/completed/failed/cancelled states
- [x] Operations activity UI with progress and cancellation controls
- [x] Cancellation for duplicate scans and folder-size scans
- [x] Cancellation for similar-photo scans
- [x] Cancellation for persistent index rebuilds
- [ ] Migrate remaining long-running conversion/archive work to the shared queue
- [x] Footprints operation history
- [x] Undo/redo for reversible rename/copy/duplicate/move/new-folder operations
- [ ] Persistent Footprints history across app launches

Native Trash is intentionally excluded from undo until Scout can restore trashed items reliably across macOS, Windows, and Linux.

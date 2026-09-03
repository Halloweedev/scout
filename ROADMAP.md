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

- [x] Persisted Hazel-style rule definitions with local manager UI
- [x] Safe dry-run preview before execution
- [x] Manual rule execution through the shared Operations queue
- [x] Rule conditions for folder, recursion, kind, extension, name, and size
- [x] Move/copy/rename rule actions
- [x] Live filesystem triggers for enabled rules
- [x] Dedicated automation watcher pool independent from active browsing
- [x] Debounced path-targeted live runs with running/cooldown loop suppression
- [x] Tag/convert/optimize/archive/script rule actions
- [x] Cross-platform Scout-local tags with context-menu editing
- [x] Shared operation queue core with queued/running/completed/failed/cancelled states
- [x] Operations activity UI with progress and cancellation controls
- [x] Cancellation for duplicate scans and folder-size scans
- [x] Cancellation for similar-photo scans
- [x] Cancellation for persistent index rebuilds
- [x] Real child-process cancellation for FFmpeg, Pandoc, LibreOffice, and program/script actions
- [x] Cancellable ZIP creation/extraction with byte and item progress
- [x] Cancellable image conversion and SHA-256 calculation through Operations
- [x] PDF mutations integrated with the shared Operations queue
- [x] Footprints operation history
- [x] Undo/redo for reversible rename/copy/duplicate/move/new-folder operations
- [x] Persistent Footprints history across app launches

M5's implementation baseline is complete. Streaming and external-process jobs support in-loop or process-level cancellation. PDF mutations are queued around Scout's existing local lopdf operations.

Native Trash is intentionally excluded from undo until Scout can restore trashed items reliably across macOS, Windows, and Linux.

## M6 — Productivity and interaction

- [x] Shared Actions Registry as the single command surface for file, navigation, selection, tab, view, tool, workspace, and developer actions
- [x] Cmd/Ctrl+K Command Palette with fuzzy matching, contextual availability, shortcuts, and recency/frequency ranking
- [x] Registry-backed context-menu actions across core utilities and power tools
- [x] Inspector with previews, metadata, tags, location, and registry-backed quick actions
- [x] QoL action packs for path/name copying, selection helpers, pane transfers, tab cleanup, symlinks, permanent delete, and IDE launchers
- [x] Per-folder view preferences and Adaptive View
- [x] Search 2.0 with deep indexed search and existing saved-search workflows
- [x] File Health analysis through Operations
- [x] Tag Smart Collections in navigation/sidebar workflows
- [x] Smart Extract for ZIP archives
- [x] Quick conversion recipes and user-defined custom actions
- [x] Foreground/background Operations scheduling with foreground priority, bounded concurrency, and queued cancellation

M6's implementation baseline is complete. Scout's power features now converge on the Actions Registry and shared Operations system instead of adding isolated command surfaces or unbounded background work.

## UX & Interaction

### UX 1 — Selection and navigation

- [x] Consistent selection semantics across List, Icons, Gallery, and Columns
- [x] Shift-range and spatial keyboard navigation
- [x] Home/End and filename type-ahead
- [x] Platform-aware open/rename shortcuts
- [x] Selection restoration after same-folder mutations
- [x] Focus and accessibility semantics

### UX 2 — Direct manipulation and feedback

- [x] Explicit Move/Copy drag intent with destination feedback
- [x] Invalid/no-op/recursive drop protection
- [x] Spring-loaded folders while dragging
- [x] Direct tab drag/reordering with visible-order close behavior
- [x] Compact live Operations HUD with progress and terminal states
- [x] Immediate Undo/Redo affordance backed by persistent Footprints history

UX 2 deliberately reuses Scout's existing filesystem, Operations, and Footprints backends. It is a direct-manipulation and feedback layer, not a second operation system.

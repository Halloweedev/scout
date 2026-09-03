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
- [x] Native OS file drops route to the hovered folder, pane, tab, sidebar destination, Portal, or native Trash target
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

## M7 — Developer-aware files

- [x] Detect the Git repository for the active folder or selected item without changing normal non-Git navigation
- [x] Read branch, upstream, ahead/behind, staged, modified, untracked, and conflict state
- [x] Git Status panel with repository summary and changed-file list
- [x] Working-tree and staged diff inspection inside Scout
- [x] Stage and unstage individual or discovered changes
- [x] Explicit-confirmation discard for tracked working-tree changes
- [x] Git commands exposed through the shared Actions Registry and Command Palette
- [x] Git subprocesses invoked directly with argument arrays rather than shell command strings
- [x] Ambient Git state in every file view with direct-file markers, nested-change folder hints, and pane-level branch/change context
- [x] Selection-aware Git context-menu actions that only surface Diff, Stage, Unstage, or Discard when the selected state supports them

M7's implementation baseline is complete. Scout is intentionally developer-aware rather than a full Git client: commit authoring, history visualization, remotes, pull requests, and hosting-service workflows remain outside this baseline.

## UX & Interaction

### UX 1 — Selection and navigation

- [x] Consistent selection semantics across List, Icons, Gallery, and Columns
- [x] Shift-range and spatial keyboard navigation
- [x] Home/End and filename type-ahead
- [x] Platform-aware open/rename shortcuts
- [x] Mouse back/forward buttons mapped to Scout pane history
- [x] Native Alt+Left/Right pane-history navigation on Windows and Linux
- [x] Native Alt+Up parent-folder navigation on Windows and Linux
- [x] Ctrl+Tab / Ctrl+Shift+Tab cycles tabs in visual order
- [x] Middle-click and Cmd/Ctrl-click navigation chrome opens breadcrumbs and sidebar folders in new tabs
- [x] Cmd/Ctrl+Shift+T recovery for recently closed tabs
- [x] Double-click empty tab-strip space to create a tab
- [x] Selection restoration after same-folder mutations
- [x] Focus and accessibility semantics

### UX 2 — Direct manipulation and feedback

- [x] Explicit Move/Copy drag intent with destination feedback
- [x] Invalid/no-op/recursive drop protection
- [x] Spring-loaded folders while dragging
- [x] Breadcrumb ancestors as direct Move/Copy drop destinations
- [x] Places, writable Locations, and Bookmarks as direct Move/Copy sidebar destinations
- [x] Spring-loaded sidebar destinations that navigate without ending the drag
- [x] Tabs as Move/Copy destinations with spring-switching while dragging
- [x] Native Trash semantics when dropping items onto the Trash sidebar target
- [x] Edge auto-scroll during internal drags, including vertical column scrolling and horizontal Miller Columns scrolling
- [x] Native OS drag/drop resolves the actual hovered Scout destination with targeted feedback and spring navigation
- [x] Direct tab drag/reordering with visible-order close behavior
- [x] Middle-click tab closing
- [x] Compact live Operations HUD with progress and terminal states
- [x] Immediate Undo/Redo affordance backed by persistent Footprints history

UX 2 deliberately reuses Scout's existing filesystem, Operations, and Footprints backends. It is a direct-manipulation and feedback layer, not a second operation system.

### UX 3 — Navigation chrome and accessibility

- [x] Overflow-safe horizontally scrollable tab strip with active-tab auto-reveal and drag-edge scrolling
- [x] Scrollable sidebar for large bookmark/workspace/location sets with drag-edge scrolling
- [x] Persisted resizable sidebar with keyboard adjustment and double-click reset
- [x] Persisted draggable splitters for 2–4 pane layouts with keyboard adjustment and 50/50 reset
- [x] Deep breadcrumb paths scroll horizontally, auto-reveal the current folder, and edge-scroll during internal drags
- [x] Current-folder Search uses progressive Escape: clear filter first, then leave the field
- [x] Quick Look follows spatial selection in all four arrow directions
- [x] Shift+F10 / Context Menu key opens the current selection's Scout context menu
- [x] Context menus expose menu/menuitem semantics and keyboard navigation with Arrow Up/Down, Home/End, Tab cycling, Enter/Space, and Escape
- [x] Context menus clamp to the visible viewport and become internally scrollable instead of rendering off-screen

UX 3 makes Scout's navigation chrome scale with real-world use and brings pointer and keyboard interaction closer to parity without creating alternate command systems.

### UX 4 — Desktop efficiency and data density

- [x] Persisted resizable Name / Modified / Size columns in List view
- [x] Pointer and keyboard List-column resizing with sensible min/max widths and reset behavior
- [x] Keyboard-sortable List headers while preserving the existing pointer sort behavior
- [x] Context-menu printable-character type-ahead over the existing visible menu actions
- [x] Empty folder space exposes folder-level context actions without requiring a selected file
- [x] Folder-background menus reuse the shared Actions Registry for compatible power tools instead of duplicating commands
- [x] Tab strip exposes tablist/tab semantics with roving focus and Arrow Left/Right + Home/End activation
- [x] Conflict-free platform tab-cycle aliases: Cmd+Shift+[ / ] on macOS and Ctrl+PageUp/PageDown on Windows/Linux
- [x] Preserve Cmd/Ctrl+1 through Cmd/Ctrl+4 for Icons / List / Columns / Gallery instead of stealing them for numbered tabs

UX 4 improves high-frequency desktop file-manager work without adding new backend systems: data density remains configurable, empty-space actions converge on the registry, and keyboard parity does not override established Scout shortcuts.

### UX 5 — Workspace organization and persistent layout

- [x] Sidebar sections collapse/expand directly and remember disclosure state across launches
- [x] Built-in and dynamically injected sidebar sections share the same disclosure behavior instead of implementing separate controls
- [x] Sidebar section headings support Enter/Space activation plus Arrow Left/Right collapse/expand semantics
- [x] Sidebar navigation supports Arrow Up/Down, Home/End, and printable-character type-ahead across visible destinations
- [x] Sidebar visibility persists and is exposed through the shared Actions Registry
- [x] Platform-aware Toggle Sidebar shortcuts: Control+Cmd+S on macOS and Ctrl+Shift+B on Windows/Linux
- [x] Bookmarks and Workspaces support persisted pointer drag reordering with insertion feedback and sidebar edge autoscroll
- [x] Focused Bookmarks and Workspaces support Alt+Arrow Up/Down reordering without colliding with ordinary sidebar focus traversal
- [x] Windows/Linux Alt+Up retains parent-folder navigation except while focus is inside a reorderable Bookmark/Workspace row
- [x] Cancelled, same-row, and no-destination reorder gestures remain no-ops instead of mutating order or activating the row
- [x] Bookmarks and Workspaces support F2 inline custom labels with Enter/blur commit and Escape cancellation
- [x] Custom sidebar labels persist by stable item ID while underlying Bookmark/Workspace records remain authoritative
- [x] Per-folder view preferences now include List sort column and direction
- [x] Saved List sorting restores safely across folder navigation, view changes, and opposite-direction same-column states

UX 5 focuses on keeping Scout arranged the way the user left it. Sidebar organization, ordering, naming, visibility, keyboard traversal, view choice, and List sorting all reuse persistent UI state rather than adding backend concepts or duplicate preference stores.

### UX 6 — Navigation memory and continuity

- [x] Returning to a previously visited folder in Icons, List, or Gallery restores surviving selected items
- [x] Back/forward and tab/folder navigation restore the remembered scroll position for that folder and view
- [x] Pointer and keyboard interactions capture the current folder state before navigation can replace the active listing
- [x] Icons, List, Columns, and Gallery keep independent in-session scroll/selection memory per folder
- [x] Miller Columns restore their horizontal scroller without synthetic row selection that could accidentally navigate
- [x] Explicit selection changes and clears replace the remembered state; missing/deleted remembered items are ignored safely
- [x] Navigation memory is session-only and bounded to the 180 most recently touched folder/view states
- [x] HMR cleanup removes listeners, observers, timers, and cached state cleanly

UX 6 makes returning somewhere feel continuous instead of freshly reset. It is intentionally an in-session UI-memory layer: filesystem state remains authoritative, stale item paths are never recreated, and Miller Columns keep their native path-driven navigation semantics.

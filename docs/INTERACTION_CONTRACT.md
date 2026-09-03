# Scout Interaction Contract

This document defines Scout's baseline file-manager behavior. New views and tools should preserve these rules unless a feature has a strong platform-specific reason not to.

## Selection

- Single click selects one item.
- Cmd-click on macOS or Ctrl-click on Windows/Linux toggles an item in the selection.
- Shift-click extends a contiguous range from the current anchor.
- Cmd/Ctrl+Shift-click adds a range to the current selection.
- Shift+Arrow extends the current range in List, Icons, Gallery, and Columns.
- Home and End jump to the first or last visible item; holding Shift extends the range.
- Clicking empty file-area space clears the selection.
- Right-clicking an unselected item selects it before opening the context menu.
- Right-clicking an item already inside a multi-selection preserves the full selection.
- After a same-folder refresh or destructive operation, Scout keeps a surviving selected item where possible; otherwise it selects the nearest remaining neighbor.

## Opening and renaming

- Double-click opens files and folders.
- Windows/Linux: Enter opens the selected item; F2 renames it.
- macOS: Return renames the selected item, matching Finder. Cmd+Down opens it.
- Middle-clicking a folder opens it in a new tab.
- Escape cancels the current transient interaction and clears selection when no editor owns Escape.

## Quick Look

- Space opens or closes Quick Look for the current selection.
- Arrow navigation continues to change the selected item while Quick Look is open, and the preview follows the selection in all four directions where the current view supports spatial movement.
- Escape closes Quick Look.

## Keyboard discovery

- Typing a file-name prefix selects the next visible matching item.
- The type-ahead buffer resets after a short pause.
- Keyboard navigation maintains a visible cursor inside a multi-selection without replacing the selection state.
- Ctrl+Tab and Ctrl+Shift+Tab cycle tabs in visual order.
- macOS also supports Cmd+Shift+[ and Cmd+Shift+] for previous/next tab; Windows/Linux support Ctrl+PageUp and Ctrl+PageDown.
- Scout preserves Cmd/Ctrl+1 through Cmd/Ctrl+4 for Icons, List, Columns, and Gallery view switching instead of overloading those shortcuts for numbered tabs.
- Windows/Linux Alt+Left and Alt+Right navigate pane history; Alt+Up navigates to the parent folder unless focus is inside a reorderable Bookmark or Workspace row, where Alt+Up belongs to sidebar reordering.

## Focus and accessibility

- Only one pane is active at a time.
- Focused and unfocused selections remain visually distinct.
- Active file surfaces expose listbox semantics and selected entries expose `aria-selected`.
- Keyboard interactions must not hijack text inputs, rename fields, search, or editable content.
- Context menus expose menu/menuitem semantics and support Shift+F10 or the platform Context Menu key from the current selection.
- Context-menu keyboard navigation uses Arrow Up/Down, Home/End, Tab/Shift+Tab cycling, Enter/Space activation, Escape dismissal, and printable-character type-ahead.
- The tab strip exposes tablist/tab semantics with a single roving tab stop; Arrow Left/Right and Home/End activate tabs when focus is inside the strip.

## Navigation chrome

- Breadcrumbs remain actionable at every visible ancestor and the current/deepest location is automatically kept in view.
- Overflowing breadcrumb paths scroll horizontally without exposing a permanent scrollbar.
- Wheel/trackpad input over an overflowing breadcrumb strip scrolls the path rather than clipping ancestors permanently.
- During an internal file drag, overflowing breadcrumbs edge-scroll so hidden ancestor drop targets remain reachable.
- Overflowing tab strips scroll horizontally and keep the active or keyboard-focused tab visible.
- Sidebar content scrolls vertically when locations, bookmarks, or workspaces exceed the available height.
- The sidebar width is directly resizable, persisted, keyboard-adjustable through its separator, and resettable to the default width.
- Multi-pane layouts expose persisted draggable splitters with keyboard-adjustable separators and a 50/50 reset.

## Sidebar organization

- Sidebar sections are disclosure controls: clicking the heading collapses/expands that section and the state persists across launches.
- The same disclosure behavior applies to Scout's built-in sections and dynamically injected sections such as Tags, Power, and Activity.
- Focused section headings use Enter/Space to toggle, Arrow Left to collapse, and Arrow Right to expand.
- When focus is inside the sidebar, Arrow Up/Down moves through visible section headings and primary destinations; Home/End jump to the first or last visible control.
- Printable-character type-ahead in the sidebar moves focus to the next visible matching section or destination and wraps through the current sidebar contents.
- Hidden/collapsed sidebar content is excluded from keyboard traversal and type-ahead.
- Bookmarks and Workspaces can be reordered directly with a pointer drag; insertion feedback shows the resulting position and edge-hovering scrolls long sidebars.
- Bookmark and Workspace order persists by stable item ID across launches, additions, removals, and collapsed-section startup states.
- Alt+Arrow Up/Down reorders the focused Bookmark or Workspace while ordinary unmodified Arrow Up/Down remains reserved for sidebar focus traversal.
- On Windows/Linux, the normal Alt+Up parent-folder alias yields only while focus is inside one of those reorderable rows.
- A reorder does not commit when the gesture is cancelled, released back over the source without a destination, or produces no actual order change.
- A completed reorder suppresses the incidental click that would otherwise open the dragged Bookmark or Workspace on pointer release.
- F2 on a focused Bookmark or Workspace opens a compact inline label editor without changing the folder path or saved pane layout.
- Enter or blur commits a custom label; Escape cancels the current edit and restores the prior visible label.
- Empty/custom labels equal to the underlying default fall back to the authoritative Bookmark or Workspace name instead of storing redundant aliases.
- Custom sidebar labels are presentation aliases stored by stable item ID; the existing Bookmark and Workspace records remain authoritative for paths, pane layouts, creation, and deletion.
- Aliases survive relaunch and ordinary additions/removals, and stale aliases are discarded when their stable item no longer exists.
- Sidebar visibility is persistent and available through the shared `Toggle Sidebar` action.
- macOS uses Control+Cmd+S for Toggle Sidebar; Windows/Linux use Ctrl+Shift+B.
- Hiding the sidebar moves focus back into the active explorer when focus was inside the sidebar, and showing it preserves the previously configured width and disclosure state.

## Folder view preferences

- Folder view preference data remains one persistent model rather than separate stores for each visual setting.
- A remembered folder may restore Icons, List, Columns, or Gallery through the existing per-folder view preference system.
- List folders also remember the active Name, Modified, or Size sort column and ascending/descending direction.
- Sort restoration runs only after the List header exists and must not be mistaken for a new user sort action.
- Restoring sorting handles both column changes and same-column opposite-direction states.
- Forget View for This Folder clears both the remembered view and its remembered List sorting.
- Adaptive View continues to apply only where no explicit folder preference is present.

## List view columns

- List view keeps Name, Modified, and Size aligned between the sticky header and file rows.
- Each List column can be resized directly by dragging its header separator, within sensible minimum and maximum widths.
- Column widths persist across launches and are shared across panes so side-by-side List views remain aligned.
- A focused column separator supports Arrow Left/Right resizing, with Shift for larger steps; Enter or double-click resets the saved List widths.
- Name, Modified, and Size headers remain sortable by pointer and are also keyboard-operable with Enter or Space.
- Resizing List columns may make the file area horizontally scrollable rather than silently compressing metadata until it becomes unreadable.

## Menus and transient surfaces

- Context menus are clamped inside the visible app viewport and become internally scrollable if their content is taller than the available space.
- Keyboard and pointer users share the same menu actions; keyboard support does not create a second command surface.
- Context-menu type-ahead searches the existing visible menu items and wraps from the current item rather than spawning a separate search UI.
- Right-clicking empty folder space opens folder-level actions such as New Folder, Paste, Select All, Copy Current Folder Path, and Bookmark Current Folder.
- Empty-space menus use the shared Actions Registry: compatible folder-level tools are enriched from the same registry rather than being duplicated in a second menu implementation.
- Opening a folder-background menu activates that pane and clears stale item selection before folder-level actions are resolved.
- Current-folder Search uses Escape progressively: the first Escape clears a non-empty filter and the next Escape exits the field.

## Drag and drop

- Dragging a selected item drags the whole selection. Dragging an unselected item drags only that item.
- The drag ghost always states the current operation intent and destination where one is available.
- Internal drags move by default. Option on macOS, or Ctrl on Windows/Linux, changes the operation to Copy while held.
- A folder row is a valid destination unless the operation would move/copy an item into itself or one of its descendants.
- Moving items back into the directory they already occupy is treated as an unavailable no-op rather than silently doing work.
- Empty pane space is a valid destination for that pane's current directory.
- Dragging outside a real Scout destination does not fall back to the active pane.
- Invalid destinations are visibly distinct and dropping on them performs no filesystem mutation.
- Portal remains an explicit non-filesystem drop target: dropping there adds references instead of moving files.
- Breadcrumb ancestors, tabs, writable sidebar destinations, and folder rows are first-class file destinations.
- Native OS drops resolve the actual hovered Scout destination instead of falling back blindly to the active folder.
- Trash remains a semantic native-trash target rather than a generic filesystem move destination.

## Spring-loaded folders

- Hovering a valid folder destination during an internal drag starts a short spring-load dwell.
- The folder visually communicates that it is about to open.
- After the dwell, Scout opens the folder while preserving the in-progress drag so the user can continue deeper into the hierarchy.
- Moving away before the dwell completes cancels the spring-load.
- The same folder is not repeatedly spring-opened during one drag gesture.
- Tabs and writable sidebar destinations may spring-switch/navigate during a drag without ending the drag gesture.

## Tabs

- Tabs can be reordered directly by dragging them horizontally.
- A small pointer threshold separates tab dragging from ordinary clicking.
- Releasing a dragged tab does not accidentally activate it.
- Close-tab behavior follows the visible tab order: closing the active tab selects the visible tab to its right, or the one to its left when there is no right neighbor.
- Cmd/Ctrl+W follows the same visible-order close behavior after tabs have been rearranged.
- Existing tab actions such as Close Tabs to the Left/Right operate on the visible order.
- Middle-click closes a tab.
- Cmd/Ctrl+Shift+T reopens the most recently closed tab.
- Double-clicking empty tab-strip space creates a new tab.
- Focused tab-strip navigation activates the target tab immediately, matching Scout's direct tab-switching model rather than maintaining a separate focus-only selection.

## Operations feedback

- Background or queued work must be observable without forcing the Operations panel open.
- While work is queued/running, Scout shows a compact live HUD with the latest active operation, progress when known, and an indicator when additional jobs are active.
- Completed, failed, and cancelled transitions remain visible briefly so operations do not appear to vanish.
- Clicking the compact HUD opens the full Operations activity view.
- The detailed Operations panel remains the source for cancellation, errors, and recent queue history.

## Undo and redo

- Reversible filesystem actions surface an immediate Undo affordance instead of requiring the user to discover Footprints first.
- Undo changes that affordance to Redo for the action that was just reversed.
- Cmd/Ctrl+Z and platform-standard redo shortcuts continue to work globally when focus is not in an editor.
- Undo/redo refreshes file views through the normal filesystem/watch path and never creates a parallel local view of filesystem state.
- Footprints remains the durable history and inspection surface for reversible operations across launches.
- Native Trash remains excluded from undo until Scout can restore trashed items reliably across macOS, Windows, and Linux.

## Versioned baseline

UX & Interaction 1.0 established selection, keyboard navigation, opening/renaming semantics, focus, and accessibility.

UX & Interaction 2.0 adds destination-aware drag/drop, spring-loaded folders, draggable tab ordering, live operation feedback, and immediate undo/redo feedback on top of Scout's existing filesystem, Operations, and Footprints backends.

UX & Interaction 3.0 adds scalable navigation chrome: overflow-safe tabs/sidebar/breadcrumbs, resizable sidebar and pane layouts, Quick Look spatial parity, and keyboard-native viewport-safe context menus.

UX & Interaction 4.0 adds dense daily-driver controls without new backend systems: persisted resizable List columns, keyboard-sortable headers, registry-backed folder-background actions, menu type-ahead, and complete tab-strip keyboard semantics with conflict-free platform shortcuts.

UX & Interaction 5.0 adds persistent workspace organization: collapsible and keyboard-traversable sidebar sections, persisted Bookmark/Workspace ordering and custom labels, persistent sidebar visibility, and per-folder List sorting integrated into the existing folder-view preference model.

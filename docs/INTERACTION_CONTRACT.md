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
- Arrow navigation continues to change the selected item while Quick Look is open, and the preview follows the selection.
- Escape closes Quick Look.

## Keyboard discovery

- Typing a file-name prefix selects the next visible matching item.
- The type-ahead buffer resets after a short pause.
- Keyboard navigation maintains a visible cursor inside a multi-selection without replacing the selection state.

## Focus and accessibility

- Only one pane is active at a time.
- Focused and unfocused selections remain visually distinct.
- Active file surfaces expose listbox semantics and selected entries expose `aria-selected`.
- Keyboard interactions must not hijack text inputs, rename fields, search, or editable content.

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

## Spring-loaded folders

- Hovering a valid folder destination during an internal drag starts a short spring-load dwell.
- The folder visually communicates that it is about to open.
- After the dwell, Scout opens the folder while preserving the in-progress drag so the user can continue deeper into the hierarchy.
- Moving away before the dwell completes cancels the spring-load.
- The same folder is not repeatedly spring-opened during one drag gesture.

## Tabs

- Tabs can be reordered directly by dragging them horizontally.
- A small pointer threshold separates tab dragging from ordinary clicking.
- Releasing a dragged tab does not accidentally activate it.
- Close-tab behavior follows the visible tab order: closing the active tab selects the visible tab to its right, or the one to its left when there is no right neighbor.
- Cmd/Ctrl+W follows the same visible-order close behavior after tabs have been rearranged.
- Existing tab actions such as Close Tabs to the Left/Right operate on the visible order.

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

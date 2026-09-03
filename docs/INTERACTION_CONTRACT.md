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

## Scope

This contract is the foundation for UX & Interaction 1.0. Drag-and-drop destination behavior, tab reordering, spring-loaded folders, operation feedback, and undo are defined by later UX phases.

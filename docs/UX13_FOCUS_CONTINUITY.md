# UX 13 — Focus and navigation continuity

Scout's keyboard interaction should remain continuous when temporary controls, menus, editors, and recovery surfaces disappear.

The core rule is simple: **the current interaction owner keeps focus; when that owner disappears, focus returns to the most logical surviving origin unless a new owner has already claimed it.**

## Implemented baseline

- The active visible sidebar destination auto-reveals when navigation elsewhere changes the current location, without stealing focus or expanding collapsed sections.
- Current-folder Search keeps progressive Escape behavior: first Escape clears the filter; second Escape leaves Search and returns focus to the active explorer surface.
- Go to Location returns focus to the active explorer after keyboard Enter/Escape completion; pointer blur remains owned by the pointer destination.
- File and Miller Columns inline rename return focus after successful Enter only once the rename editor is actually removed.
- Rename failure keeps the editor and its focus intact so the user can correct the value.
- Rename Escape cancels and returns focus to the explorer immediately.
- New Folder inherits the same rename-completion behavior, allowing New Folder → type → Enter → continue navigating entirely from the keyboard.
- Toolbar menus return focus to their opening toolbar button after Escape and after keyboard action execution when the menu closes.
- File/background context-menu keyboard actions return focus to the active explorer only when the menu closes without another editor/dialog/control taking ownership.
- Contextual selection actions preserve keyboard continuity for both quick actions and overflow actions. Overflow returns to More when it survives; actions that remove the contextual bar fall back to the active explorer.
- Retry, Go to Parent, Paste, New Folder, and Search Everywhere recovery actions preserve a new modal/editor focus owner when one appears, otherwise disappearing keyboard controls fall back to the explorer.
- Back/Forward history menus, breadcrumb sibling menus, and tab menus remember their logical opener and restore it when the pop-up closes. If the opener itself was removed, focus falls back to the surviving active tab or explorer.
- Command Palette and modal utility surfaces continue to use the UX11 modal contract, so nested dialogs and commands that open editors/dialogs retain priority over fallback focus restoration.
- Bookmark/Workspace inline rename already restores focus to its exact sidebar row and remains unchanged.
- Tabs already use roving focus, activation-following focus, active-tab auto-reveal, and file-key shielding; UX13 does not create a second tab focus model.

## Ownership rules

1. A newly opened modal/editor/menu is allowed to claim focus.
2. Fallback restoration only runs when focus has otherwise collapsed to `body`/the document.
3. Pointer interactions are not rewritten into keyboard focus changes unless the surface itself has native popup-return semantics.
4. Focus restoration reuses existing owner controls and explorer surfaces; it does not synthesize file selection or navigation.
5. HMR cleanup removes observers, timers, and listeners introduced by the continuity helpers.

UX13 is a presentation/interaction layer. It does not change filesystem state, Actions Registry semantics, saved Workspace behavior, or the Operations system.

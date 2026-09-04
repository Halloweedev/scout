# UX 18 — Display Continuity

Scout keeps global display choices continuous across relaunches instead of resetting high-frequency viewing preferences each time the app starts.

## Contract

- Hidden-files visibility persists across launches in App-owned UI state.
- Scout's initial Home listing and subsequent navigation use the restored hidden-files preference immediately; no startup shortcut replay or DOM inference is involved.
- Toolbar and keyboard hidden-file toggles update the same persisted preference through the existing `toggleHiddenFiles()` owner path.
- Restoring a saved Workspace still applies that Workspace's recorded hidden-files mode, and that explicit restore becomes the new global persisted hidden-files preference.
- Item zoom persists across launches through the existing App-owned zoom state.
- Zoom restoration falls back to `1` when storage is missing or invalid.
- Restored and newly persisted zoom values are bounded to Scout's existing `0.85`–`1.4` range.
- Zoom writes are rounded to two decimal places so repeated `+` / `-` steps do not accumulate floating-point noise in storage.
- Cmd/Ctrl `+`, `-`, and `0` retain their existing behavior and Actions Registry commands continue to route through those App-owned shortcuts.

## Ownership boundary

UX18 does not create a second preference layer. `App.tsx` remains authoritative for hidden-files visibility and zoom. Per-folder view mode, List sorting, Adaptive View, sidebar layout, pane split ratios, and other existing preferences remain owned by their current persistence systems.

Tab restoration is also intentionally outside UX18. Scout's current tab model stores one active-pane path/history while the pane graph is independent, so relaunch restoration should not invent tab-to-layout semantics that the core model does not represent.

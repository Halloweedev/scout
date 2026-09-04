# UX 16 — Pane session continuity

Scout now restores the ordinary multi-pane browsing layout from the previous launch without turning that transient session into a saved Workspace.

- `workspace.add-pane`, `workspace.close-pane`, and `workspace.toggle-linked-panes` are canonical Actions Registry commands.
- Those commands delegate to Scout's existing toolbar and pane owner controls; they do not duplicate `addPane`, `removePane`, or linked-navigation state.
- Session continuity persists up to four pane paths plus the active pane index in `scout.session.layout.v1`.
- The previous `scout.session.last-location.v1` value remains a migration/fallback source and is still updated for compatibility.
- Every stored pane path is validated through Scout's existing filesystem layer before reconstruction.
- Stale, deleted, disconnected, or otherwise invalid panes are dropped instead of creating broken panes.
- If the previously active pane is invalid, the nearest surviving pane becomes active.
- A cold launch reconstructs panes through `workspace.add-pane` and navigates them through the existing `scout:navigate` owner path.
- If linked-pane navigation was enabled, Scout temporarily disables it only after the second pane exists, restores individual pane paths, then restores linked mode.
- Real trusted pointer or keyboard input during restore cancels the remaining automatic reconstruction; synthetic owner events do not count as user interruption.
- HMR/non-cold-start installs with an already multi-pane live UI treat that live layout as authoritative instead of destructively rebuilding it.
- The settled pane graph is updated as panes are focused, navigated, added, or removed and is written once more on `pagehide`.
- Storage/action failures are non-fatal; Scout keeps the live layout it successfully reached.

## Superseded startup path

UX19 moves cold-start reconstruction into the App owner. `scout.session.layout.v1` remains the persisted pane-layout format, but App now validates and publishes the pane graph together with the saved tab model before the legacy continuity observer can replay toolbar/actions. The observer remains responsible for ongoing layout capture, migration fallback, interruption safety, and `pagehide` persistence.

Tabs still do not own complete pane graphs. Only the active tab's path/history snapshot is attached to the active shared pane, preserving the semantics UX16 established.

Saved Workspaces remain explicit named user layouts. Session continuity is automatic transient state and never creates, renames, or mutates a saved Workspace.

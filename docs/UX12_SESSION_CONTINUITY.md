# UX 12 — Startup continuity

Scout should reopen into useful context instead of resetting the user to Home on every launch.

## Implemented baseline

- Scout remembers the path of the active explorer pane in local UI storage.
- On the next launch, the saved path is validated through Scout's existing filesystem layer before navigation is requested.
- A valid saved path is restored through the existing `scout:navigate` owner path rather than through a second navigation implementation.
- A deleted, disconnected, or otherwise invalid saved path is discarded and Scout remains at its normal Home startup location.
- The temporary Home location shown while restore is being validated is not allowed to overwrite the previous saved location.
- If the user navigates while startup restore is still in flight, user intent wins immediately and the automatic restore is cancelled.
- The settled active location is also persisted on `pagehide` as a final best-effort snapshot.
- Storage errors are non-fatal: continuity is an enhancement and must never block normal browsing.
- Mutation observers and page lifecycle listeners are removed during HMR cleanup.

## Extended by UX 16

UX16 builds on this baseline and now restores the previous multi-pane graph: up to four validated pane paths plus the active pane index. Pane creation and linked-mode changes are routed through canonical Actions Registry commands that delegate to App-owned controls, while folder navigation continues through `scout:navigate`.

The legacy `scout.session.last-location.v1` value remains supported as a migration/fallback source, while the richer transient layout is stored separately in `scout.session.layout.v1`.

## Intentional boundary

Tabs are still not reconstructed as a multi-pane session graph. Scout's current `ExplorerTab` model stores one active-pane path/history snapshot, while panes are shared outside the tab model. Rebuilding tabs as though each tab owned its own pane layout would change current semantics and is intentionally deferred.

Saved Workspaces remain explicit user-created layouts and keep their existing semantics. Startup continuity is separate automatic session state and never silently creates or mutates a saved Workspace.

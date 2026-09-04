# UX 12 — Startup continuity

Scout should reopen into useful context instead of resetting the user to Home on every launch.

## Implemented baseline

- Scout remembers the path of the active explorer pane in local UI storage.
- On the next launch, the saved path is validated through Scout's existing filesystem layer before navigation is requested.
- A valid saved path is restored through the existing `scout:navigate` owner path rather than through a second navigation implementation.
- A deleted, disconnected, or otherwise invalid saved path is discarded and Scout remains at its normal Home startup location.
- The temporary Home location shown while restore is being validated is not allowed to overwrite the previous saved location.
- If the user navigates while startup restore is still in flight, user intent wins immediately and the automatic restore is cancelled.
- A bounded restore timeout prevents startup continuity from remaining stuck in an intermediate state if the target cannot become active.
- The settled active location is also persisted on `pagehide` as a final best-effort snapshot.
- Storage errors are non-fatal: continuity is an enhancement and must never block normal browsing.
- Mutation observers, timers, and page lifecycle listeners are removed during HMR cleanup.

## Intentional boundary

This checkpoint restores the last active folder only. Scout does **not** yet reconstruct the full previous tab/pane graph at startup.

Full layout restoration should be built only after tabs and panes expose canonical owner-level restore primitives. In particular, Add Pane is currently toolbar-owned rather than a shared Actions Registry command, so UX12 must not automate hidden toolbar DOM or introduce a parallel pane state model just to recreate a previous layout.

Saved Workspaces remain explicit user-created layouts and keep their existing semantics. Startup continuity is separate: it remembers where ordinary browsing last stopped without silently creating or mutating a saved Workspace.

# UX 20 — Native Window Continuity

Scout now treats the desktop window as part of relaunch continuity instead of restoring only in-app navigation state.

## Contract

- `scout.session.window.v1` stores the main window's last normal position and size plus whether it was maximized.
- Geometry is captured from Tauri's native window APIs. Scout does not infer window state from DOM dimensions.
- Position and size are stored in physical pixels, matching Tauri's native monitor and window geometry APIs.
- Restored dimensions respect Scout's configured 900×580 minimum window size.
- Before restoring, saved geometry is reconciled against the currently available monitor work areas.
- If a display disappeared or its work area changed, Scout chooses the best remaining monitor and clamps the window fully back on-screen.
- Maximized sessions restore the saved normal bounds first and maximize afterwards, so unmaximizing returns to a useful previous size instead of the maximized desktop bounds.
- Resize/move persistence is debounced and last-write guarded so stale asynchronous captures cannot overwrite newer geometry.
- A maximized resize never replaces the saved normal bounds.
- Window continuity is best-effort. Storage, monitor, or native-window failures fall back to Tauri's configured default window instead of blocking Scout startup.
- HMR cleanup removes native window listeners, timers, and page lifecycle handlers.

## Relationship to existing session state

UX20 is deliberately separate from `scout.session.layout.v1` and `scout.session.tabs.v1`.

The App owner remains authoritative for tabs and the shared pane graph. `session-continuity.ts` remains responsible for pane-layout capture/migration. UX20 owns only native desktop window geometry and maximized state through Tauri's window APIs.

That separation prevents monitor/window concerns from leaking into Scout's filesystem/navigation model while completing the relaunch experience established by UX12, UX16, UX18, and UX19.

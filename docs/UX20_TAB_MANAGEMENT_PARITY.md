# UX 20 — Tab Management Parity

Scout exposes tab reordering as a first-class command instead of making pointer drag the only way to change tab order.

## Contract

- The active tab can move one position left or right through the shared Actions Registry and Command Palette.
- The active tab can move directly to the start or end of the tab strip through the same registry.
- Focused tabs support Option/Alt+Shift+Arrow Left/Right for one-step keyboard reordering without colliding with Windows/Linux Alt+Left/Right history navigation.
- Reorder commands are only available when they would materially change the active tab position; first/last edge cases remain truthful no-ops.
- Command-driven reordering uses the same visible-order layer as pointer drag and emits the canonical `scout:tabs-reordered` event.
- `App.tsx` remains authoritative: it consumes the reordered `data-tab-id` sequence, updates `tabs()`, and lets UX19 persist that order through the existing tab-session continuity path.
- Command reordering does not create a second tab array, storage key, or hidden ordering model.
- The moved tab retains keyboard focus and is scrolled back into view after the App-owned state update.
- Reorder commands are unavailable while a pointer tab drag is actively in progress.
- HMR cleanup unregisters the Actions Registry commands together with the existing tab-drag listeners and observer.

## Commands

- `Move Active Tab Left`
- `Move Active Tab Right`
- `Move Active Tab to Start`
- `Move Active Tab to End`

## Ownership boundary

`tab-drag.ts` owns direct-manipulation ordering and the translation from a requested visual move into `scout:tabs-reordered`. `App.tsx` owns the canonical `ExplorerTab[]`, active tab identity, history, paths, and session persistence. UX20 extends the existing UX19 boundary rather than adding another source of truth.

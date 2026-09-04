# UX 17 — Canonical Tab Commands

Scout routes cross-cutting tab creation through one interaction bridge instead of letting feature modules press the rendered New Tab control or synthesize file-row mouse gestures.

## Contract

- `requestNewTab()` asks Scout to create a tab through the same platform shortcut path owned by `App` (`Cmd+T` on macOS, `Ctrl+T` elsewhere).
- `requestOpenTab(path)` creates a tab through that owner path, waits until the tab has actually been added, then navigates the new active tab through the existing `scout:navigate` contract.
- Opening a tab no longer assumes that one microtask is enough for Solid to reconcile the tab strip.
- If the new tab does not materialize within the bounded wait, Scout reports the failure instead of navigating the current tab by accident.
- Feature modules do not query and click `.new-tab-button` to perform tab creation.
- Feature modules do not synthesize an auxiliary click on a file row merely to reach another module's new-tab behavior.

## Migrated surfaces

- Breadcrumb and sidebar modifier/middle-click navigation.
- Reopen-closed-tab and blank-tab-strip double-click behavior.
- UX3 duplicate/reopen/breadcrumb new-tab flows.
- Action Registry commands for New Tab and Open Folder in New Tab.

The rendered `.new-tab-button` remains a normal user-facing control and may still be referenced structurally by tab layout/drag code. UX17 removes programmatic button-clicking as an inter-module command mechanism; it does not remove the control itself.

## Ownership boundary

`App` remains the source of truth for Solid tab state. The bridge deliberately invokes App-owned command paths rather than maintaining a second tab model. A future explicit owner API can replace the shortcut bridge without changing the feature-level callers.

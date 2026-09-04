# UX 19 — Owner tab session continuity

Scout now restores ordinary tabs as real `ExplorerTab` model state instead of reopening path-only shells or replaying synthetic tab clicks.

## Contract

- `scout.session.tabs.v1` persists up to 24 recent tabs in visual/model order.
- Each persisted tab keeps its current folder, title, up to 80 bounded history entries, and history index.
- The active tab index is restored with the tab list.
- Cold-start restoration validates saved tab and pane paths through Scout's existing filesystem layer before publishing UI state.
- If a saved tab's current folder disappeared, Scout checks nearby entries in that tab's own back/forward history before dropping the tab.
- Invalid pane paths are dropped; if the saved active pane disappeared, the nearest surviving pane becomes active.
- The pane graph from `scout.session.layout.v1` and the tab model are reconstructed in one App-owned transaction so pane restoration cannot overwrite restored tab history.
- The active shared pane receives the active tab's restored history and history index. Other panes remain shared pane state; tabs do not gain private pane graphs.
- The owner-resolved pane layout is written before DOM publication so the older continuity observer sees an already-settled graph instead of replaying Add Pane/navigation actions.
- Tab drag reordering is reconciled back into App state through stable `data-tab-id` identities, so visual order and model/persisted order cannot diverge.
- Tab persistence is reactive to real App tab state changes and also writes a final best-effort snapshot on `pagehide`.
- Storage and stale-path failures remain non-fatal; Scout falls back to the nearest valid session state or Home.

## Ownership boundary

`App.tsx` remains the source of truth for tabs, pane focus, and the active tab/pane history relationship. UX19 does not create a parallel tab model and does not mutate saved Workspaces.

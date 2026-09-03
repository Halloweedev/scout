# UX 8 — Actionable explorer states

Scout should not leave the user at a dead end when a folder is empty, a filter has no matches, a location fails to load, or a folder takes noticeably longer to open.

## Baseline

- Empty folders expose **New Folder** and **Paste** when those actions are available.
- A current-folder filter with no matches exposes **Clear Filter** and **Search Everywhere**.
- Active-pane load failures keep the original error visible and expose **Retry** and **Go to Parent** when available.
- Retry and parent navigation resolve through the shared Actions Registry (`navigation.refresh` and `navigation.parent`) rather than duplicating filesystem or path logic.
- Long folder loads add a restrained `Loading folder…` status only after a short delay so fast local navigation does not flash extra copy.
- Generated recovery UI is limited to the active pane and preserves the underlying source state for cleanup/accessibility restoration.
- Recovery-state DOM mutations are drained from the observer queue so generated UI cannot create a self-sustaining reconciliation loop.
- HMR cleanup disconnects observers, cancels delayed loading feedback, removes generated surfaces, and restores the original empty-state accessibility state.

## System rule

Recovery UI is a presentation layer, not another operation system. Whenever Scout already has the needed behavior, the recovery surface must resolve and execute the existing registry action instead of reimplementing it.

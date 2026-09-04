# UX 11 — Modal focus and nesting

Scout's modal sheets and dialogs share one keyboard/focus contract instead of reimplementing focus behavior independently.

- Opening a modal moves focus inside it unless the surface already focused one of its own controls.
- Tab and Shift+Tab remain trapped inside the topmost modal and wrap at the first/last available control.
- Escape dismisses only the topmost modal, using the surface's existing Close/backdrop path rather than removing owned DOM directly.
- Closing a nested modal restores focus to the control that opened it when that control still exists.
- Closing the last modal restores focus to the originating Scout control when possible.
- Replacing one dialog with another preserves the original restore target instead of restoring focus through `body` or another transient node.
- Focus attempts outside an open modal are redirected back into the topmost modal.
- Key events that bubble through modal content stop at the modal boundary, preventing App-level file shortcuts from acting on stale explorer selection.
- Managed dialogs expose `aria-modal="true"`, a programmatic fallback focus target, and an accessible name inferred from their existing heading/title when they do not already provide one.
- Attributes introduced by the focus contract are restored on dialog removal/HMR cleanup instead of becoming permanent DOM mutations.
- Existing semantic dialogs participate automatically, including Operations, Git Diff, File Health, Custom Actions, Command Palette, and Tag Smart Collections.
- Older modal utility sheets are brought under the same contract without changing their feature ownership: Tags/utility sheets, Image Tools, PDF tools, Disk Map, Duplicate Finder, converters, Similar Photos, Automation, and Global Search.
- Global Search keeps its own search-result Arrow/Enter behavior while UX 11 owns Tab containment, focus restoration, modal semantics, and topmost Escape dismissal.
- Portal is intentionally excluded because it is a persistent floating shelf rather than a blocking modal.
- Quick Look is intentionally excluded because browsing the underlying explorer selection with arrow keys while previewing is part of its interaction model.
- The contract is presentation-only: each feature continues to own its own close, action, data, and filesystem behavior.

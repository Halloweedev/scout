# UX 11 — Modal focus and nesting

Scout's modal sheets and dialogs share one keyboard/focus contract instead of reimplementing focus behavior independently.

- Opening a modal moves focus inside it unless the surface already focused one of its own controls.
- Tab and Shift+Tab remain trapped inside the topmost modal and wrap at the first/last available control.
- Escape dismisses only the topmost modal, using the surface's existing Close/backdrop path rather than removing owned DOM directly.
- Closing a nested modal restores focus to the control that opened it when that control still exists.
- Closing the last modal restores focus to the originating Scout control when possible.
- Focus attempts outside an open modal are redirected back into the topmost modal.
- Key events that bubble through modal content stop at the modal boundary, preventing App-level file shortcuts from acting on stale explorer selection.
- Managed dialogs expose `aria-modal="true"`, a programmatic fallback focus target, and an accessible name when a heading is available.
- Tag Smart Collection pickers participate in the same dialog contract even though their original panel markup did not declare `role="dialog"`.
- The contract is presentation-only: each feature continues to own its own close, action, data, and filesystem behavior.

# UX 12 — Destructive confirmation

Scout uses one in-app confirmation surface for irreversible or data-losing actions instead of browser-native `window.confirm` dialogs.

- Permanent delete is confirmed inside Scout before calling the native delete command.
- Git working-tree discard uses the same confirmation surface from both the Git Status sheet and the shared Actions Registry.
- The confirmation copy states the actual consequence of the command, including that Git discard restores only the working tree and leaves staged index changes intact.
- Cancel is the initial focus target; the destructive action is never the default focused control.
- The confirmation surface is a real `role="dialog"` and therefore inherits UX 11 focus containment, topmost Escape dismissal, nested focus restoration, and stale file-shortcut shielding.
- Clicking outside cancels rather than confirms.
- Multiple programmatic confirmation requests are serialized so destructive prompts cannot overlap.
- HMR cleanup resolves outstanding confirmations as cancelled instead of leaving orphaned overlays or unresolved promises.
- Destructive styling is intentionally restrained and reserved for the actual confirmation button.
- Existing action ownership is preserved: the confirmation layer decides only whether the caller may continue; filesystem and Git modules still own their mutations, refreshes, and feedback.

UX 12 removes Scout's remaining browser-native `window.confirm` calls and gives destructive actions the same interaction contract as the rest of the app.

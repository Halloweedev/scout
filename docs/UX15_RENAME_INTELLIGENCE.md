# UX 15 — Rename intelligence

Scout treats inline rename as a continuous desktop-file-manager workflow instead of a plain text input.

- File rename selects the filename stem while preserving the final extension outside the initial selection.
- Folder rename still selects the complete folder name.
- The behavior is derived from Scout's existing row metadata (`data-entry-kind` / `data-entry-extension`) rather than guessing from arbitrary dots in names, so dotfiles and unusual names are not blindly truncated.
- List, Icons, Gallery, and Miller Columns share the same selection behavior through the existing rename editors.
- Tab commits the current rename and starts rename on the next visible item in the same file surface.
- Shift+Tab does the same in the previous direction.
- Sequential rename does not wrap at the first/last item; reaching an edge commits and returns to normal explorer interaction.
- The next item is resolved before the mutation, but the handoff waits until the current rename editor is actually removed. A failed rename therefore cannot silently advance to another item.
- Sequential handoff reuses Scout's existing row selection and F2 rename owner path instead of mutating filesystem state directly.
- Enter and Escape retain their existing commit/cancel semantics and focus-restoration behavior.
- Rename appearance/completion observers and delayed selection timers are removed during HMR cleanup.

UX 15 is an interaction layer only. App/ColumnBrowser remain authoritative for rename validation, filesystem mutation, errors, selection state, and the actual rename editor lifecycle.

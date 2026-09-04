let renameCompletionObserver: MutationObserver | null = null;
let renameAppearanceObserver: MutationObserver | null = null;
let renameTimeout: number | undefined;
let pendingRenameInput: HTMLInputElement | null = null;
let pendingSequentialPath: string | null = null;
const preparedRenameInputs = new WeakSet<HTMLInputElement>();
const renameSelectionTimers = new Map<HTMLInputElement, number>();

function searchInputFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return null;
  return target.closest(".search-box") ? target : null;
}

function locationInputFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return null;
  return target.classList.contains("location-input") ? target : null;
}

function renameInputFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return null;
  return target.matches(".rename-input, .column-browser-rename") ? target : null;
}

function focusActiveExplorer() {
  const area = document.querySelector<HTMLElement>(".explorer-pane.active .file-area");
  area?.focus({ preventScroll: true });
}

function renameRow(input: HTMLInputElement) {
  return input.closest<HTMLElement>(".pane-file-row[data-entry-path]");
}

function selectRenameStem(input: HTMLInputElement) {
  if (!input.isConnected) return;
  const row = renameRow(input);
  const value = input.value;
  const kind = row?.dataset.entryKind;
  const extension = row?.dataset.entryExtension?.replace(/^\.+/, "") ?? "";
  let end = value.length;

  if (kind !== "directory" && extension) {
    const suffix = `.${extension}`;
    if (value.length > suffix.length && value.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) {
      end = value.length - suffix.length;
    }
  }

  input.focus({ preventScroll: true });
  input.setSelectionRange(0, Math.max(0, end));
}

function prepareRenameInput(input: HTMLInputElement) {
  if (preparedRenameInputs.has(input)) return;
  preparedRenameInputs.add(input);
  const timer = window.setTimeout(() => {
    renameSelectionTimers.delete(input);
    selectRenameStem(input);
  }, 0);
  renameSelectionTimers.set(input, timer);
}

function prepareRenameEditors(root: ParentNode) {
  if (root instanceof HTMLInputElement && root.matches(".rename-input, .column-browser-rename")) {
    prepareRenameInput(root);
  }
  root.querySelectorAll?.<HTMLInputElement>(".rename-input, .column-browser-rename").forEach(prepareRenameInput);
}

function renameRows(input: HTMLInputElement) {
  const scope = input.closest<HTMLElement>(".column-browser-column")
    ?? input.closest<HTMLElement>(".explorer-pane.active");
  if (!scope) return [] as HTMLElement[];
  return [...scope.querySelectorAll<HTMLElement>(".pane-file-row[data-entry-path]")]
    .filter((row) => row.offsetParent !== null);
}

function sequentialRenamePath(input: HTMLInputElement, delta: number) {
  const current = renameRow(input);
  if (!current) return null;
  const rows = renameRows(input);
  const index = rows.indexOf(current);
  const next = rows[index + delta];
  return index >= 0 ? next?.dataset.entryPath ?? null : null;
}

function rowForPath(path: string) {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row[data-entry-path]")]
    .find((row) => row.offsetParent !== null && row.dataset.entryPath === path) ?? null;
}

function beginSequentialRename(path: string) {
  const row = rowForPath(path);
  if (!row) {
    focusActiveExplorer();
    return;
  }
  row.scrollIntoView({ block: "nearest", inline: "nearest" });
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  focusActiveExplorer();
  queueMicrotask(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
  });
}

function clearRenameWatch() {
  renameCompletionObserver?.disconnect();
  renameCompletionObserver = null;
  if (renameTimeout !== undefined) window.clearTimeout(renameTimeout);
  renameTimeout = undefined;
  pendingRenameInput = null;
  pendingSequentialPath = null;
}

function finishRenameWatchIfUnmounted() {
  if (!pendingRenameInput || pendingRenameInput.isConnected) return;
  const nextPath = pendingSequentialPath;
  clearRenameWatch();
  if (nextPath) queueMicrotask(() => beginSequentialRename(nextPath));
  else focusActiveExplorer();
}

function watchRenameCompletion(input: HTMLInputElement, nextPath: string | null = null) {
  if (pendingRenameInput === input && pendingSequentialPath === nextPath) return;
  clearRenameWatch();
  pendingRenameInput = input;
  pendingSequentialPath = nextPath;
  renameCompletionObserver = new MutationObserver(finishRenameWatchIfUnmounted);
  renameCompletionObserver.observe(document.body, { childList: true, subtree: true });
  renameTimeout = window.setTimeout(clearRenameWatch, 5000);
}

function handleKeyDown(event: KeyboardEvent) {
  const renameInput = renameInputFromTarget(event.target);
  if (renameInput && event.key === "Tab" && !event.altKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const nextPath = sequentialRenamePath(renameInput, event.shiftKey ? -1 : 1);
    watchRenameCompletion(renameInput, nextPath);
    renameInput.blur();
    return;
  }

  if (renameInput && (event.key === "Enter" || event.key === "Escape")) {
    if (event.key === "Enter") {
      // Rename commits asynchronously and blur also commits, so do not move
      // focus until the owner actually removes the editor after success.
      watchRenameCompletion(renameInput);
    } else {
      clearRenameWatch();
      window.setTimeout(focusActiveExplorer, 0);
    }
    return;
  }

  const locationInput = locationInputFromTarget(event.target);
  if (locationInput && (event.key === "Enter" || event.key === "Escape")) {
    // App owns committing/cancelling the location editor. Re-enter the explorer
    // only after Solid removes the input so keyboard file navigation resumes.
    window.setTimeout(focusActiveExplorer, 0);
    return;
  }

  if (event.key !== "Escape") return;
  const input = searchInputFromTarget(event.target);
  if (!input) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (input.value) {
    input.value = "";
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward",
      data: null,
    }));
    return;
  }
  input.blur();
  focusActiveExplorer();
}

export function installSearchInteractions() {
  renameAppearanceObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) prepareRenameEditors(node);
      }
    }
  });
  renameAppearanceObserver.observe(document.body, { childList: true, subtree: true });
  prepareRenameEditors(document);
  window.addEventListener("keydown", handleKeyDown, true);

  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    clearRenameWatch();
    renameAppearanceObserver?.disconnect();
    renameAppearanceObserver = null;
    for (const timer of renameSelectionTimers.values()) window.clearTimeout(timer);
    renameSelectionTimers.clear();
  };
}

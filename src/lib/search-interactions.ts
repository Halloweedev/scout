let renameObserver: MutationObserver | null = null;
let renameTimeout: number | undefined;
let pendingRenameInput: HTMLInputElement | null = null;

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

function clearRenameWatch() {
  renameObserver?.disconnect();
  renameObserver = null;
  if (renameTimeout !== undefined) window.clearTimeout(renameTimeout);
  renameTimeout = undefined;
  pendingRenameInput = null;
}

function finishRenameWatchIfUnmounted() {
  if (!pendingRenameInput || pendingRenameInput.isConnected) return;
  clearRenameWatch();
  focusActiveExplorer();
}

function watchRenameCompletion(input: HTMLInputElement) {
  if (pendingRenameInput === input) return;
  clearRenameWatch();
  pendingRenameInput = input;
  renameObserver = new MutationObserver(finishRenameWatchIfUnmounted);
  renameObserver.observe(document.body, { childList: true, subtree: true });
  renameTimeout = window.setTimeout(clearRenameWatch, 5000);
}

function handleKeyDown(event: KeyboardEvent) {
  const renameInput = renameInputFromTarget(event.target);
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
  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    clearRenameWatch();
  };
}

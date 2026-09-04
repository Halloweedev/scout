function searchInputFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return null;
  return target.closest(".search-box") ? target : null;
}

function locationInputFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return null;
  return target.classList.contains("location-input") ? target : null;
}

function focusActiveExplorer() {
  const area = document.querySelector<HTMLElement>(".explorer-pane.active .file-area");
  area?.focus({ preventScroll: true });
}

function handleKeyDown(event: KeyboardEvent) {
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
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}

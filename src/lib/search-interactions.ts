function searchInputFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return null;
  return target.closest(".search-box") ? target : null;
}

function handleKeyDown(event: KeyboardEvent) {
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
}

export function installSearchInteractions() {
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}

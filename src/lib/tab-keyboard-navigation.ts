function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function tabs() {
  return [...document.querySelectorAll<HTMLElement>(".tab-strip > .tab")];
}

function cycleTab(direction: 1 | -1) {
  const ordered = tabs();
  if (ordered.length < 2) return false;
  const activeIndex = ordered.findIndex((tab) => tab.classList.contains("active"));
  if (activeIndex < 0) return false;
  const nextIndex = (activeIndex + direction + ordered.length) % ordered.length;
  ordered[nextIndex]?.click();
  return true;
}

function handleKeyDown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return;
  if (!event.ctrlKey || event.metaKey || event.altKey || event.key !== "Tab") return;
  if (!cycleTab(event.shiftKey ? -1 : 1)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function installTabKeyboardNavigation() {
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}

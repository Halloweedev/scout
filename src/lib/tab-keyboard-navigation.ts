const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

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
  const next = ordered[nextIndex];
  if (!next) return false;
  next.click();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function requestedDirection(event: KeyboardEvent): 1 | -1 | null {
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
    return event.shiftKey ? -1 : 1;
  }

  if (isMac && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey) {
    if (event.code === "BracketLeft") return -1;
    if (event.code === "BracketRight") return 1;
  }

  if (!isMac && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key === "PageUp") return -1;
    if (event.key === "PageDown") return 1;
  }

  return null;
}

function handleKeyDown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return;
  const direction = requestedDirection(event);
  if (!direction || !cycleTab(direction)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function installTabKeyboardNavigation() {
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}

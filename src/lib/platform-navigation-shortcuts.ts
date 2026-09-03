const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function handleKeyDown(event: KeyboardEvent) {
  if (isMac || isEditableTarget(event.target)) return;
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== "ArrowUp") return;

  event.preventDefault();
  event.stopImmediatePropagation();
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "ArrowUp",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
}

export function installPlatformNavigationShortcuts() {
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}

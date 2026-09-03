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
  ordered[nextIndex]?.click();
  return true;
}

function activateNumberedTab(digit: number) {
  const ordered = tabs();
  if (!ordered.length) return false;
  const index = digit === 9 ? ordered.length - 1 : digit - 1;
  const tab = ordered[index];
  if (!tab) return false;
  tab.click();
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function handleKeyDown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return;

  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
    if (!cycleTab(event.shiftKey ? -1 : 1)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const numberedModifier = isMac
    ? event.metaKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.metaKey && !event.altKey;
  if (!numberedModifier || event.shiftKey) return;
  const match = /^Digit([1-9])$/.exec(event.code);
  if (!match) return;
  if (!activateNumberedTab(Number(match[1]))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function installTabKeyboardNavigation() {
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}

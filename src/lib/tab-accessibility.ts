let observer: MutationObserver | null = null;
let reconcileQueued = false;

function tabElements(strip: HTMLElement) {
  return [...strip.querySelectorAll<HTMLButtonElement>(":scope > .tab")];
}

function tabLabel(tab: HTMLElement) {
  return tab.querySelector<HTMLElement>(":scope > span:not(.tab-close)")?.textContent?.trim()
    || tab.textContent?.trim()
    || "Folder tab";
}

function reconcileStrip(strip: HTMLElement) {
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Folder tabs");
  const tabs = tabElements(strip);
  const active = tabs.find((tab) => tab.classList.contains("active")) ?? tabs[0] ?? null;
  for (const tab of tabs) {
    const selected = tab === active;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.setAttribute("aria-label", tabLabel(tab));
    tab.tabIndex = selected ? 0 : -1;
  }
}

function reconcile() {
  reconcileQueued = false;
  for (const strip of document.querySelectorAll<HTMLElement>(".tab-strip")) reconcileStrip(strip);
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function moveFocus(strip: HTMLElement, current: HTMLButtonElement, key: string) {
  const tabs = tabElements(strip);
  if (!tabs.length) return false;
  const index = tabs.indexOf(current);
  if (index < 0) return false;
  let nextIndex = index;
  if (key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
  else if (key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
  else if (key === "Home") nextIndex = 0;
  else if (key === "End") nextIndex = tabs.length - 1;
  else return false;
  const next = tabs[nextIndex];
  if (!next) return false;
  next.click();
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  queueMicrotask(() => reconcileStrip(strip));
  return true;
}

function handleKeyDown(event: KeyboardEvent) {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest<HTMLButtonElement>(".tab-strip > .tab");
  const strip = tab?.closest<HTMLElement>(".tab-strip");
  if (!tab || !strip) return;
  if (!moveFocus(strip, tab, event.key)) return;
  event.preventDefault();
  event.stopPropagation();
}

function handleFocusIn(event: FocusEvent) {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest<HTMLButtonElement>(".tab-strip > .tab");
  if (!tab) return;
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function installTabAccessibility() {
  reconcile();
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("focusin", handleFocusIn, true);

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("focusin", handleFocusIn, true);
    for (const strip of document.querySelectorAll<HTMLElement>(".tab-strip")) {
      strip.removeAttribute("role");
      strip.removeAttribute("aria-label");
      for (const tab of tabElements(strip)) {
        tab.removeAttribute("role");
        tab.removeAttribute("aria-selected");
        tab.removeAttribute("aria-label");
        tab.removeAttribute("tabindex");
      }
    }
  };
}

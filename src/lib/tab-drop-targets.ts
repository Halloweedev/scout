const SPRING_DELAY_MS = 720;

let observer: MutationObserver | null = null;
let queued = false;
let springTimer: number | null = null;
let springTab: HTMLElement | null = null;

function tabLabel(tab: HTMLElement) {
  return tab.querySelector<HTMLElement>(":scope > span:not(.tab-close)")?.textContent?.trim()
    || tab.textContent?.trim()
    || "Tab";
}

function reconcile() {
  queued = false;
  const activeTab = document.querySelector<HTMLElement>(".tab-strip > .tab.active");
  const activePane = document.querySelector<HTMLElement>(".explorer-pane.active[data-pane-path]");
  const path = activePane?.dataset.panePath;
  if (!activeTab || !path) return;

  activeTab.dataset.scoutDropPath = path;
  activeTab.dataset.scoutDropLabel = tabLabel(activeTab);
  activeTab.dataset.scoutDropAction = "tab";
}

function scheduleReconcile() {
  if (queued) return;
  queued = true;
  queueMicrotask(reconcile);
}

function clearSpring() {
  if (springTimer !== null) window.clearTimeout(springTimer);
  springTimer = null;
  springTab?.classList.remove("internal-drop-spring");
  springTab = null;
}

function hoveredDropTab(event: PointerEvent) {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  return hit?.closest<HTMLElement>(".tab-strip > .tab[data-scout-drop-action='tab']") ?? null;
}

function handlePointerMove(event: PointerEvent) {
  if (!document.documentElement.classList.contains("internal-file-drag")) {
    clearSpring();
    return;
  }

  const tab = hoveredDropTab(event);
  if (!tab || tab.classList.contains("active") || !tab.dataset.scoutDropPath) {
    clearSpring();
    return;
  }
  if (springTab === tab) return;

  clearSpring();
  springTab = tab;
  tab.classList.add("internal-drop-spring");
  springTimer = window.setTimeout(() => {
    springTimer = null;
    const target = springTab;
    if (!target || !target.isConnected || target.classList.contains("active")) {
      clearSpring();
      return;
    }
    target.classList.remove("internal-drop-spring");
    springTab = null;
    target.click();
  }, SPRING_DELAY_MS);
}

function handleDragEnd() {
  clearSpring();
}

export function installTabDropTargets() {
  observer = new MutationObserver(scheduleReconcile);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path"],
  });
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handleDragEnd);
  window.addEventListener("pointercancel", handleDragEnd);
  scheduleReconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    queued = false;
    clearSpring();
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handleDragEnd);
    window.removeEventListener("pointercancel", handleDragEnd);
    document.querySelectorAll<HTMLElement>(".tab-strip > .tab[data-scout-drop-action='tab']").forEach((tab) => {
      delete tab.dataset.scoutDropPath;
      delete tab.dataset.scoutDropLabel;
      delete tab.dataset.scoutDropAction;
    });
  };
}

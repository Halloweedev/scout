let observer: MutationObserver | null = null;
let queued = false;

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

export function installTabDropTargets() {
  observer = new MutationObserver(scheduleReconcile);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path"],
  });
  scheduleReconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    queued = false;
    document.querySelectorAll<HTMLElement>(".tab-strip > .tab[data-scout-drop-action='tab']").forEach((tab) => {
      delete tab.dataset.scoutDropPath;
      delete tab.dataset.scoutDropLabel;
      delete tab.dataset.scoutDropAction;
    });
  };
}

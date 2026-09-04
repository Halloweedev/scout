import { registerActions } from "./actions";
import { requestNewTab } from "./tab-commands";

const DRAG_THRESHOLD = 7;

interface TabCandidate {
  tab: HTMLElement;
  startX: number;
  startY: number;
}

type TabReorderTarget = "left" | "right" | "first" | "last";

let observer: MutationObserver | null = null;
let candidate: TabCandidate | null = null;
let dragging: HTMLElement | null = null;
let orderedTabs: HTMLElement[] = [];
let dragStartOrder: HTMLElement[] = [];
let suppressClickTab: HTMLElement | null = null;
let suppressClickUntil = 0;
let reconciling = false;

function tabStrip() {
  return document.querySelector<HTMLElement>(".tab-strip");
}

function tabsInDom() {
  const strip = tabStrip();
  if (!strip) return [];
  return [...strip.querySelectorAll<HTMLElement>(":scope > .tab")];
}

function activeTab() {
  return tabsInDom().find((tab) => tab.classList.contains("active")) ?? null;
}

function tabFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".tab-strip > .tab");
}

function sameOrder(left: HTMLElement[], right: HTMLElement[]) {
  return left.length === right.length && left.every((tab, index) => tab === right[index]);
}

function syncOrderFromDom() {
  orderedTabs = tabsInDom();
}

function placeTabsInOrder(order: HTMLElement[]) {
  const strip = tabStrip();
  if (!strip) return;
  const current = tabsInDom();
  const desired = order.filter((tab) => tab.isConnected && tab.parentElement === strip && current.includes(tab));
  if (sameOrder(current, desired)) return;

  const newTabButton = strip.querySelector<HTMLElement>(":scope > .new-tab-button");
  reconciling = true;
  try {
    for (const tab of desired) strip.insertBefore(tab, newTabButton);
    observer?.takeRecords();
  } finally {
    reconciling = false;
  }
}

function reconcileOrder() {
  const strip = tabStrip();
  if (!strip) {
    orderedTabs = [];
    return;
  }

  const current = tabsInDom();
  if (!orderedTabs.length) {
    orderedTabs = current;
    return;
  }

  const connected = orderedTabs.filter((tab) => tab.isConnected && tab.parentElement === strip && current.includes(tab));
  const newTabs = current.filter((tab) => !connected.includes(tab));
  const desired = [...connected, ...newTabs];
  orderedTabs = desired;
  if (!sameOrder(current, desired)) placeTabsInOrder(desired);
}

function restoreDragStartOrder() {
  const current = tabsInDom();
  if (!dragStartOrder.length || !current.length) return;
  const restored = dragStartOrder.filter((tab) => current.includes(tab));
  const additions = current.filter((tab) => !restored.includes(tab));
  const desired = [...restored, ...additions];
  placeTabsInOrder(desired);
  orderedTabs = tabsInDom();
}

function reorderedTabs(tab: HTMLElement, target: TabReorderTarget) {
  reconcileOrder();
  const current = [...orderedTabs];
  const from = current.indexOf(tab);
  if (from < 0 || current.length < 2) return null;

  let to = from;
  if (target === "left") to = Math.max(0, from - 1);
  else if (target === "right") to = Math.min(current.length - 1, from + 1);
  else if (target === "first") to = 0;
  else to = current.length - 1;
  if (to === from) return null;

  current.splice(from, 1);
  current.splice(to, 0, tab);
  return current;
}

function canReorderTab(target: TabReorderTarget, tab = activeTab()) {
  return !!tab && !!reorderedTabs(tab, target);
}

function requestTabReorder(target: TabReorderTarget, tab = activeTab()) {
  if (!tab || dragging) return false;
  const desired = reorderedTabs(tab, target);
  if (!desired) return false;
  const tabId = tab.dataset.tabId;
  placeTabsInOrder(desired);
  orderedTabs = desired;
  observer?.takeRecords();
  window.dispatchEvent(new CustomEvent("scout:tabs-reordered", {
    detail: { source: "command", tabId: tabId ?? null },
  }));
  queueMicrotask(() => {
    const current = tabId
      ? tabsInDom().find((candidate) => candidate.dataset.tabId === tabId) ?? tab
      : tab;
    if (!current.isConnected) return;
    current.focus({ preventScroll: true });
    current.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  return true;
}

function visualNeighbor(tab: HTMLElement) {
  reconcileOrder();
  const index = orderedTabs.indexOf(tab);
  if (index < 0) return null;
  return orderedTabs[index + 1] ?? orderedTabs[index - 1] ?? null;
}

function prepareActiveClose(tab: HTMLElement) {
  if (!tab.classList.contains("active")) return;
  const neighbor = visualNeighbor(tab);
  if (neighbor) neighbor.click();
}

function closeTabElement(tab: HTMLElement) {
  const close = tab.querySelector<HTMLElement>(".tab-close");
  if (!close) return false;
  prepareActiveClose(tab);
  close.click();
  return true;
}

function endDrag() {
  if (dragging) {
    dragging.classList.remove("ux-tab-dragging");
    dragging.removeAttribute("aria-grabbed");
  }
  document.documentElement.classList.remove("ux-tab-drag-active");
  document.querySelectorAll<HTMLElement>(".tab-strip > .tab.ux-tab-drop-before, .tab-strip > .tab.ux-tab-drop-after")
    .forEach((tab) => tab.classList.remove("ux-tab-drop-before", "ux-tab-drop-after"));
  dragging = null;
  candidate = null;
  dragStartOrder = [];
}

function beginDrag(tab: HTMLElement) {
  reconcileOrder();
  dragStartOrder = [...orderedTabs];
  dragging = tab;
  tab.classList.add("ux-tab-dragging");
  tab.setAttribute("aria-grabbed", "true");
  document.documentElement.classList.add("ux-tab-drag-active");
}

function moveDraggedTab(x: number) {
  const strip = tabStrip();
  const dragged = dragging;
  if (!strip || !dragged) return;

  const target = document.elementFromPoint(x, strip.getBoundingClientRect().top + strip.getBoundingClientRect().height / 2)
    ?.closest<HTMLElement>(".tab-strip > .tab");
  if (!target || target === dragged) return;

  document.querySelectorAll<HTMLElement>(".tab-strip > .tab.ux-tab-drop-before, .tab-strip > .tab.ux-tab-drop-after")
    .forEach((tab) => tab.classList.remove("ux-tab-drop-before", "ux-tab-drop-after"));

  const rect = target.getBoundingClientRect();
  const before = x < rect.left + rect.width / 2;
  target.classList.add(before ? "ux-tab-drop-before" : "ux-tab-drop-after");

  if (before) strip.insertBefore(dragged, target);
  else strip.insertBefore(dragged, target.nextElementSibling);
  observer?.takeRecords();
  syncOrderFromDom();
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest(".tab-close, .new-tab-button")) return;
  const tab = tabFromTarget(event.target);
  if (!tab) return;
  candidate = { tab, startX: event.clientX, startY: event.clientY };
}

function handlePointerMove(event: PointerEvent) {
  if (!candidate) return;
  if (!dragging) {
    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (distance < DRAG_THRESHOLD) return;
    beginDrag(candidate.tab);
  }
  event.preventDefault();
  moveDraggedTab(event.clientX);
}

function handlePointerUp() {
  if (!candidate) return;
  const completed = !!dragging;
  const dragged = dragging;
  if (completed && dragged) {
    syncOrderFromDom();
    const changed = !sameOrder(dragStartOrder, orderedTabs);
    suppressClickTab = dragged;
    suppressClickUntil = performance.now() + 180;
    if (changed) window.dispatchEvent(new CustomEvent("scout:tabs-reordered"));
  }
  endDrag();
}

function handlePointerCancel() {
  if (dragging) restoreDragStartOrder();
  endDrag();
}

function handleAuxClick(event: MouseEvent) {
  if (event.button !== 1) return;
  const tab = tabFromTarget(event.target);
  if (!tab) return;
  if (!closeTabElement(tab)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleDoubleClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const strip = target?.closest<HTMLElement>(".tab-strip");
  if (!strip || target?.closest(".tab, .new-tab-button")) return;
  if (!requestNewTab()) return;
  event.preventDefault();
}

function handleClickCapture(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const close = target?.closest<HTMLElement>(".tab-close");
  if (close) {
    const tab = close.closest<HTMLElement>(".tab");
    if (tab) prepareActiveClose(tab);
    return;
  }

  const tab = tabFromTarget(event.target);
  if (!tab || tab !== suppressClickTab || performance.now() > suppressClickUntil) return;
  suppressClickTab = null;
  suppressClickUntil = 0;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && dragging) {
    restoreDragStartOrder();
    endDrag();
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const focusedTab = tabFromTarget(event.target);
  if (focusedTab && event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey
    && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    if (requestTabReorder(event.key === "ArrowLeft" ? "left" : "right", focusedTab)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }

  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (!modifier || event.shiftKey || event.altKey || key !== "w") return;
  const tabs = tabsInDom();
  if (tabs.length <= 1) return;
  const active = tabs.find((tab) => tab.classList.contains("active"));
  if (!active) return;
  if (!closeTabElement(active)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function installAccessibility() {
  for (const tab of tabsInDom()) {
    tab.setAttribute("draggable", "false");
    tab.setAttribute("aria-grabbed", "false");
  }
}

function reconcile() {
  if (dragging || reconciling) return;
  reconcileOrder();
  installAccessibility();
}

export function installTabDrag() {
  const unregisterActions = registerActions([
    {
      id: "tabs.move-left",
      title: "Move Active Tab Left",
      category: "Tabs",
      keywords: ["reorder", "shift", "tab", "left"],
      shortcut: "⇧⌥← / Alt+Shift+←",
      available: () => canReorderTab("left"),
      run: () => { requestTabReorder("left"); },
    },
    {
      id: "tabs.move-right",
      title: "Move Active Tab Right",
      category: "Tabs",
      keywords: ["reorder", "shift", "tab", "right"],
      shortcut: "⇧⌥→ / Alt+Shift+→",
      available: () => canReorderTab("right"),
      run: () => { requestTabReorder("right"); },
    },
    {
      id: "tabs.move-first",
      title: "Move Active Tab to Start",
      category: "Tabs",
      keywords: ["reorder", "first", "start", "tab"],
      available: () => canReorderTab("first"),
      run: () => { requestTabReorder("first"); },
    },
    {
      id: "tabs.move-last",
      title: "Move Active Tab to End",
      category: "Tabs",
      keywords: ["reorder", "last", "end", "tab"],
      available: () => canReorderTab("last"),
      run: () => { requestTabReorder("last"); },
    },
  ]);

  observer = new MutationObserver(() => {
    if (dragging || reconciling) {
      observer?.takeRecords();
      return;
    }
    queueMicrotask(reconcile);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerCancel);
  document.addEventListener("auxclick", handleAuxClick, true);
  document.addEventListener("dblclick", handleDoubleClick, true);
  document.addEventListener("click", handleClickCapture, true);
  window.addEventListener("keydown", handleKeyDown, true);
  queueMicrotask(reconcile);

  return () => {
    unregisterActions();
    if (dragging) restoreDragStartOrder();
    observer?.disconnect();
    observer = null;
    document.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
    document.removeEventListener("auxclick", handleAuxClick, true);
    document.removeEventListener("dblclick", handleDoubleClick, true);
    document.removeEventListener("click", handleClickCapture, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    orderedTabs = [];
    dragStartOrder = [];
    suppressClickTab = null;
    suppressClickUntil = 0;
    reconciling = false;
    endDrag();
  };
}

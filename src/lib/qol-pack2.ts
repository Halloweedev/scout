import { registerActions, type ScoutActionContext } from "./actions";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function visibleActiveRows() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row")]
    .filter((row) => row.offsetParent !== null && !!row.dataset.entryPath);
}

function invertSelection() {
  const rows = visibleActiveRows();
  if (!rows.length) throw new Error("No visible items to invert");
  for (const row of rows) {
    row.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: isMac,
      ctrlKey: !isMac,
    }));
  }
}

function activeTabElements() {
  return [...document.querySelectorAll<HTMLElement>(".tab-strip .tab")];
}

function closeTabsOnSide(side: "left" | "right") {
  const tabs = activeTabElements();
  const activeIndex = tabs.findIndex((tab) => tab.classList.contains("active"));
  if (activeIndex < 0) throw new Error("No active tab");
  const targets = side === "left" ? tabs.slice(0, activeIndex) : tabs.slice(activeIndex + 1).reverse();
  for (const tab of targets) tab.querySelector<HTMLElement>(".tab-close")?.click();
}

function otherPane() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane")]
    .find((pane) => !pane.classList.contains("active")) ?? null;
}

function focusPaneElement(pane: HTMLElement) {
  pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
}

function openFolderInOtherPane(context: ScoutActionContext) {
  const target = context.selection[0];
  if (!target || target.kind !== "directory") throw new Error("Select one folder");
  const destinationPane = otherPane();
  const originalPane = document.querySelector<HTMLElement>(".explorer-pane.active");
  if (!destinationPane || !originalPane) throw new Error("Add another pane first");

  focusPaneElement(destinationPane);
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: target.path } }));
  queueMicrotask(() => focusPaneElement(originalPane));
}

export function installQolPack2() {
  return registerActions([
    {
      id: "selection.invert",
      title: "Invert Selection",
      category: "Selection",
      keywords: ["inverse", "toggle", "select everything else"],
      available: (context) => !!context.panePath,
      run: () => invertSelection(),
    },
    {
      id: "tabs.close-left",
      title: "Close Tabs to the Left",
      category: "Tabs",
      keywords: ["tabs", "cleanup", "left"],
      available: (context) => context.tabCount > 1,
      run: () => closeTabsOnSide("left"),
    },
    {
      id: "tabs.close-right",
      title: "Close Tabs to the Right",
      category: "Tabs",
      keywords: ["tabs", "cleanup", "right"],
      available: (context) => context.tabCount > 1,
      run: () => closeTabsOnSide("right"),
    },
    {
      id: "file.open-other-pane",
      title: "Open in Other Pane",
      category: "File",
      keywords: ["split", "pane", "side by side", "folder"],
      contextMenu: true,
      contextMenuOrder: 6,
      available: (context) => context.selection.length === 1
        && context.selection[0].kind === "directory"
        && document.querySelectorAll(".explorer-pane").length > 1,
      run: (context) => openFolderInOtherPane(context),
    },
  ]);
}

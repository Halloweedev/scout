import { invoke } from "@tauri-apps/api/core";
import { registerActions, type ScoutActionContext } from "./actions";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

interface SymlinkResult {
  source: string;
  link: string;
}

function toast(message: string) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message } }));
}

function refreshCurrentFolder() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }));
}

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

function tabsOnSide(side: "left" | "right") {
  const tabs = activeTabElements();
  const activeIndex = tabs.findIndex((tab) => tab.classList.contains("active"));
  if (activeIndex < 0) return [];
  return side === "left" ? tabs.slice(0, activeIndex) : tabs.slice(activeIndex + 1);
}

function closeTabsOnSide(side: "left" | "right") {
  const targets = tabsOnSide(side);
  const ordered = side === "right" ? [...targets].reverse() : targets;
  for (const tab of ordered) tab.querySelector<HTMLElement>(".tab-close")?.click();
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

function parentDirectory(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return path;
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.slice(0, index);
}

async function permanentDelete(context: ScoutActionContext) {
  if (!context.selectedPaths.length) throw new Error("Select at least one item");
  const count = context.selectedPaths.length;
  const label = count === 1 ? context.selection[0]?.name ?? "this item" : `${count} items`;
  const confirmed = window.confirm(`Permanently delete ${label}?\n\nThis skips the Trash and cannot be undone.`);
  if (!confirmed) return;
  await invoke<void>("delete_entries_permanently", { paths: context.selectedPaths });
  refreshCurrentFolder();
  toast(count === 1 ? "Permanently deleted item" : `Permanently deleted ${count} items`);
}

async function createSymlinks(context: ScoutActionContext) {
  if (!context.panePath || !context.selectedPaths.length) throw new Error("Select one or more items");
  const result = await invoke<SymlinkResult[]>("create_symlinks", {
    paths: context.selectedPaths,
    destination: context.panePath,
  });
  refreshCurrentFolder();
  toast(result.length === 1 ? "Created symlink" : `Created ${result.length} symlinks`);
}

async function revealSymlinkTarget(context: ScoutActionContext) {
  const entry = context.selection[0];
  if (!entry || entry.kind !== "symlink") throw new Error("Select one symbolic link");
  const target = await invoke<string>("symlink_target", { path: entry.path });
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: parentDirectory(target) } }));
  toast(`Symlink target: ${target}`);
}

function developerPath(context: ScoutActionContext) {
  return context.selection.length === 1 ? context.selection[0].path : context.panePath;
}

async function openInIde(context: ScoutActionContext, ide: "vscode" | "zed" | "cursor") {
  const path = developerPath(context);
  if (!path) throw new Error("No file or folder is available to open");
  await invoke<void>("open_in_ide", { path, ide });
}

export function installQolPack2() {
  return registerActions([
    {
      id: "selection.invert",
      title: "Invert Selection",
      category: "Selection",
      keywords: ["inverse", "toggle", "select everything else"],
      available: (context) => !!context.panePath && visibleActiveRows().length > 0,
      run: () => invertSelection(),
    },
    {
      id: "tabs.close-left",
      title: "Close Tabs to the Left",
      category: "Tabs",
      keywords: ["tabs", "cleanup", "left"],
      available: () => tabsOnSide("left").length > 0,
      run: () => closeTabsOnSide("left"),
    },
    {
      id: "tabs.close-right",
      title: "Close Tabs to the Right",
      category: "Tabs",
      keywords: ["tabs", "cleanup", "right"],
      available: () => tabsOnSide("right").length > 0,
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
    {
      id: "file.create-symlink",
      title: "Create Symlink Here",
      category: "File",
      keywords: ["symbolic link", "alias", "shortcut", "link"],
      contextMenu: true,
      contextMenuOrder: 80,
      available: (context) => context.selectedPaths.length > 0 && !!context.panePath,
      run: (context) => createSymlinks(context),
    },
    {
      id: "file.reveal-symlink-target",
      title: "Reveal Symlink Target Folder",
      category: "File",
      keywords: ["symbolic link", "target", "destination", "reveal"],
      contextMenu: true,
      contextMenuOrder: 81,
      available: (context) => context.selection.length === 1 && context.selection[0].kind === "symlink",
      run: (context) => revealSymlinkTarget(context),
    },
    {
      id: "file.delete-permanently",
      title: "Delete Permanently…",
      category: "File",
      keywords: ["delete", "remove", "skip trash", "irreversible"],
      danger: true,
      contextMenu: true,
      contextMenuOrder: 99,
      available: (context) => context.selectedPaths.length > 0,
      run: (context) => permanentDelete(context),
    },
    {
      id: "developer.open-vscode",
      title: "Open in VS Code",
      category: "Developer",
      keywords: ["visual studio code", "code", "ide", "editor"],
      available: (context) => !!developerPath(context),
      run: (context) => openInIde(context, "vscode"),
    },
    {
      id: "developer.open-zed",
      title: "Open in Zed",
      category: "Developer",
      keywords: ["zed", "ide", "editor"],
      available: (context) => !!developerPath(context),
      run: (context) => openInIde(context, "zed"),
    },
    {
      id: "developer.open-cursor",
      title: "Open in Cursor",
      category: "Developer",
      keywords: ["cursor", "ide", "editor"],
      available: (context) => !!developerPath(context),
      run: (context) => openInIde(context, "cursor"),
    },
  ]);
}

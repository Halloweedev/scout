import { createFolder, duplicateEntries, moveEntries, openEntry, trashEntries } from "./fs";
import { registerActions, type ScoutAction, type ScoutActionContext } from "./actions";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const modLabel = isMac ? "⌘" : "Ctrl+";

function toast(message: string) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message } }));
}

function dispatchShortcut(key: string, options: { shift?: boolean; alt?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    metaKey: isMac,
    ctrlKey: !isMac,
    shiftKey: !!options.shift,
    altKey: !!options.alt,
    bubbles: true,
    cancelable: true,
  }));
}

function dispatchPlainKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

async function copyText(value: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
  toast(label);
}

function basename(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function relativePath(base: string, target: string) {
  const windows = /^[A-Za-z]:[\\/]/.test(base) || /^[A-Za-z]:[\\/]/.test(target) || base.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  const split = (value: string) => value.replace(/[\\/]+$/, "").split(/[\\/]+/).filter(Boolean);
  const from = split(base);
  const to = split(target);
  if (windows && from[0]?.toLocaleLowerCase() !== to[0]?.toLocaleLowerCase()) return target;
  let common = 0;
  while (common < from.length && common < to.length) {
    const left = windows ? from[common].toLocaleLowerCase() : from[common];
    const right = windows ? to[common].toLocaleLowerCase() : to[common];
    if (left !== right) break;
    common += 1;
  }
  return [...Array(from.length - common).fill(".."), ...to.slice(common)].join(separator) || ".";
}

function quotePath(path: string) {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) return `"${path.replace(/"/g, '\\"')}"`;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function fileUri(path: string) {
  if (/^[A-Za-z]:[\\/]/.test(path)) return `file:///${encodeURI(path.replace(/\\/g, "/"))}`;
  return `file://${encodeURI(path)}`;
}

function hasSelection(context: ScoutActionContext) {
  return context.selectedPaths.length > 0;
}

function oneSelection(context: ScoutActionContext) {
  return context.selection.length === 1;
}

function oneDirectory(context: ScoutActionContext) {
  return context.selection.length === 1 && context.selection[0].kind === "directory";
}

function selectedRow(path: string) {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row")]
    .find((row) => row.dataset.entryPath === path) ?? null;
}

function click(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error("That Scout control is not available here");
  element.click();
}

function openDirectoryInNewTab(context: ScoutActionContext) {
  const entry = context.selection[0];
  const row = selectedRow(entry.path);
  if (!row) throw new Error("The selected folder is no longer visible");
  row.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
}

async function closeOtherTabs() {
  for (let guard = 0; guard < 20; guard += 1) {
    const close = document.querySelector<HTMLElement>(".tab:not(.active) .tab-close");
    if (!close) break;
    close.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function currentPath(context: ScoutActionContext) {
  if (!context.panePath) throw new Error("No active folder");
  return context.panePath;
}

function actions(): ScoutAction[] {
  return [
    {
      id: "file.open",
      title: "Open",
      category: "File",
      keywords: ["launch", "enter"],
      shortcut: "Enter",
      available: oneSelection,
      run: async (context) => {
        const entry = context.selection[0];
        if (entry.kind === "directory") window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: entry.path } }));
        else await openEntry(entry.path);
      },
    },
    {
      id: "file.open-new-tab",
      title: "Open Folder in New Tab",
      category: "Tabs",
      keywords: ["folder", "tab"],
      contextMenu: true,
      contextMenuOrder: 5,
      available: oneDirectory,
      run: openDirectoryInNewTab,
    },
    {
      id: "file.quick-look",
      title: "Quick Look",
      category: "File",
      shortcut: "Space",
      keywords: ["preview"],
      contextMenu: true,
      contextMenuOrder: 10,
      available: hasSelection,
      run: () => dispatchPlainKey(" "),
    },
    {
      id: "file.rename",
      title: "Rename",
      category: "File",
      shortcut: "F2",
      available: oneSelection,
      run: () => dispatchPlainKey("F2"),
    },
    {
      id: "file.duplicate",
      title: "Duplicate",
      category: "File",
      keywords: ["clone", "copy"],
      available: hasSelection,
      run: async (context) => {
        await duplicateEntries(context.selectedPaths);
        toast(context.selectedPaths.length === 1 ? "Duplicated item" : `Duplicated ${context.selectedPaths.length} items`);
      },
    },
    {
      id: "file.trash",
      title: "Move to Trash",
      category: "File",
      keywords: ["delete", "remove"],
      danger: true,
      available: hasSelection,
      run: async (context) => {
        await trashEntries(context.selectedPaths);
        toast(context.selectedPaths.length === 1 ? "Moved to Trash" : `Moved ${context.selectedPaths.length} items to Trash`);
      },
    },
    {
      id: "file.copy-path",
      title: "Copy Path",
      category: "File",
      keywords: ["clipboard", "absolute", "location"],
      contextMenu: true,
      contextMenuOrder: 20,
      available: hasSelection,
      run: (context) => copyText(context.selectedPaths.join("\n"), context.selectedPaths.length === 1 ? "Copied path" : `Copied ${context.selectedPaths.length} paths`),
    },
    {
      id: "file.copy-relative-path",
      title: "Copy Relative Path",
      category: "File",
      keywords: ["clipboard", "relative"],
      contextMenu: true,
      contextMenuOrder: 21,
      available: (context) => hasSelection(context) && !!context.panePath,
      run: (context) => copyText(context.selectedPaths.map((path) => relativePath(currentPath(context), path)).join("\n"), "Copied relative path"),
    },
    {
      id: "file.copy-quoted-path",
      title: "Copy Quoted Path",
      category: "File",
      keywords: ["terminal", "shell", "clipboard"],
      contextMenu: true,
      contextMenuOrder: 22,
      available: hasSelection,
      run: (context) => copyText(context.selectedPaths.map(quotePath).join(" "), "Copied quoted path"),
    },
    {
      id: "file.copy-name",
      title: "Copy Filename",
      category: "File",
      keywords: ["name", "clipboard"],
      contextMenu: true,
      contextMenuOrder: 23,
      available: hasSelection,
      run: (context) => copyText(context.selection.map((entry) => entry.name || basename(entry.path)).join("\n"), "Copied filename"),
    },
    {
      id: "file.copy-uri",
      title: "Copy File URI",
      category: "File",
      keywords: ["url", "uri", "clipboard"],
      available: hasSelection,
      run: (context) => copyText(context.selectedPaths.map(fileUri).join("\n"), "Copied file URI"),
    },
    {
      id: "file.new-folder",
      title: "New Folder",
      category: "File",
      shortcut: `${modLabel}⇧N`,
      keywords: ["create", "directory"],
      available: (context) => !!context.panePath,
      run: async (context) => {
        const folder = await createFolder(currentPath(context));
        toast(`Created ${folder.name}`);
      },
    },
    {
      id: "file.folder-with-selection",
      title: "New Folder with Selection",
      category: "File",
      subtitle: "Create a folder and move the selected items into it",
      keywords: ["organize", "group", "selection"],
      available: (context) => hasSelection(context) && !!context.panePath,
      run: async (context) => {
        const folder = await createFolder(currentPath(context));
        try {
          await moveEntries(context.selectedPaths, folder.path);
          toast(`Moved selection into ${folder.name}`);
        } catch (error) {
          throw new Error(`Created ${folder.name}, but could not move the selection: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      id: "clipboard.copy",
      title: "Copy Selection",
      category: "Selection",
      shortcut: `${modLabel}C`,
      available: hasSelection,
      run: () => dispatchShortcut("c"),
    },
    {
      id: "clipboard.cut",
      title: "Cut Selection",
      category: "Selection",
      shortcut: `${modLabel}X`,
      available: hasSelection,
      run: () => dispatchShortcut("x"),
    },
    {
      id: "clipboard.paste",
      title: "Paste",
      category: "File",
      shortcut: `${modLabel}V`,
      available: (context) => !!context.panePath,
      run: () => dispatchShortcut("v"),
    },
    {
      id: "selection.all",
      title: "Select All",
      category: "Selection",
      shortcut: `${modLabel}A`,
      available: (context) => !!context.panePath,
      run: () => dispatchShortcut("a"),
    },
    {
      id: "selection.clear",
      title: "Clear Selection",
      category: "Selection",
      shortcut: "Esc",
      available: hasSelection,
      run: () => dispatchPlainKey("Escape"),
    },
    {
      id: "navigation.back",
      title: "Go Back",
      category: "Navigation",
      shortcut: isMac ? "⌘[" : "Alt+←",
      run: () => dispatchShortcut("["),
    },
    {
      id: "navigation.forward",
      title: "Go Forward",
      category: "Navigation",
      shortcut: isMac ? "⌘]" : "Alt+→",
      run: () => dispatchShortcut("]"),
    },
    {
      id: "navigation.parent",
      title: "Go to Parent Folder",
      category: "Navigation",
      shortcut: `${modLabel}↑`,
      available: (context) => !!context.panePath,
      run: () => dispatchShortcut("ArrowUp"),
    },
    {
      id: "navigation.location",
      title: "Go to Location…",
      category: "Navigation",
      shortcut: `${modLabel}L`,
      keywords: ["path", "address", "folder"],
      run: () => dispatchShortcut("l"),
    },
    {
      id: "navigation.filter",
      title: "Filter Current Folder",
      category: "Navigation",
      shortcut: `${modLabel}F`,
      keywords: ["find", "search"],
      run: () => dispatchShortcut("f"),
    },
    {
      id: "navigation.global-search",
      title: "Search All Files…",
      category: "Navigation",
      shortcut: `${modLabel}⇧F`,
      keywords: ["global", "index", "find", "saved search"],
      run: () => window.dispatchEvent(new CustomEvent("scout:open-global-search")),
    },
    {
      id: "navigation.copy-folder-path",
      title: "Copy Current Folder Path",
      category: "Navigation",
      keywords: ["location", "clipboard"],
      available: (context) => !!context.panePath,
      run: (context) => copyText(currentPath(context), "Copied folder path"),
    },
    {
      id: "tabs.new",
      title: "New Tab",
      category: "Tabs",
      shortcut: `${modLabel}T`,
      run: () => click(".new-tab-button"),
    },
    {
      id: "tabs.duplicate",
      title: "Duplicate Current Tab",
      category: "Tabs",
      keywords: ["clone", "same folder"],
      available: (context) => context.hasActiveTab,
      run: () => click(".new-tab-button"),
    },
    {
      id: "tabs.close",
      title: "Close Tab",
      category: "Tabs",
      shortcut: `${modLabel}W`,
      available: (context) => context.tabCount > 1,
      run: () => dispatchShortcut("w"),
    },
    {
      id: "tabs.close-others",
      title: "Close Other Tabs",
      category: "Tabs",
      keywords: ["cleanup"],
      available: (context) => context.tabCount > 1,
      run: closeOtherTabs,
    },
    {
      id: "view.icons",
      title: "View as Icons",
      category: "View",
      shortcut: `${modLabel}1`,
      run: () => dispatchShortcut("1"),
    },
    {
      id: "view.list",
      title: "View as List",
      category: "View",
      shortcut: `${modLabel}2`,
      run: () => dispatchShortcut("2"),
    },
    {
      id: "view.columns",
      title: "View as Columns",
      category: "View",
      shortcut: `${modLabel}3`,
      run: () => dispatchShortcut("3"),
    },
    {
      id: "view.gallery",
      title: "View as Gallery",
      category: "View",
      shortcut: `${modLabel}4`,
      run: () => dispatchShortcut("4"),
    },
    {
      id: "tools.inspector",
      title: "Toggle Inspector",
      category: "Tools",
      shortcut: `${modLabel}I`,
      keywords: ["details", "info", "metadata", "properties"],
      run: () => window.dispatchEvent(new CustomEvent("scout:toggle-inspector")),
    },
    {
      id: "workspace.bookmark",
      title: "Bookmark Current Folder",
      category: "Workspace",
      keywords: ["favorite", "pin", "sidebar"],
      available: (context) => !!context.panePath,
      run: () => click('[aria-label="Bookmark current folder"]'),
    },
    {
      id: "workspace.save",
      title: "Save Current Workspace",
      category: "Workspace",
      keywords: ["panes", "layout"],
      available: (context) => !!context.panePath,
      run: () => click('[aria-label="Save workspace"]'),
    },
  ];
}

export function installQolActions() {
  return registerActions(actions());
}

import { createFolder, moveEntries, openEntry } from "./fs";
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

function dispatchAltKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    altKey: true,
    bubbles: true,
    cancelable: true,
  }));
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

function enabledToolbarControl(label: "Back" | "Forward" | "Up") {
  const button = document.querySelector<HTMLButtonElement>(`.toolbar button[aria-label="${label}"]`);
  return !!button && !button.disabled;
}

function hasVisibleEntries() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row[data-entry-path]")]
    .some((row) => row.offsetParent !== null);
}

function actions(): ScoutAction[] {
  return [
    {
      id: "file.open",
      title: "Open",
      category: "File",
      keywords: ["launch", "enter"],
      shortcut: isMac ? "⌘↓" : "Enter",
      available: oneSelection,
      run: () => isMac ? dispatchShortcut("ArrowDown") : dispatchPlainKey("Enter"),
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
      shortcut: isMac ? "Return" : "F2",
      available: oneSelection,
      run: () => dispatchPlainKey("F2"),
    },
    {
      id: "file.duplicate",
      title: "Duplicate",
      category: "File",
      shortcut: `${modLabel}D`,
      keywords: ["clone", "copy"],
      available: hasSelection,
      run: () => dispatchShortcut("d"),
    },
    {
      id: "file.trash",
      title: "Move to Trash",
      category: "File",
      shortcut: isMac ? "⌘⌫" : "Delete",
      keywords: ["delete", "remove"],
      danger: true,
      available: hasSelection,
      run: () => dispatchPlainKey("Delete"),
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
      run: () => dispatchShortcut("n", { shift: true }),
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
      available: (context) => !!context.panePath && (context.clipboardCount ?? 0) > 0,
      run: () => dispatchShortcut("v"),
    },
    {
      id: "selection.all",
      title: "Select All",
      category: "Selection",
      shortcut: `${modLabel}A`,
      available: (context) => !!context.panePath && hasVisibleEntries(),
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
      available: () => enabledToolbarControl("Back"),
      run: () => isMac ? dispatchShortcut("[") : dispatchAltKey("ArrowLeft"),
    },
    {
      id: "navigation.forward",
      title: "Go Forward",
      category: "Navigation",
      shortcut: isMac ? "⌘]" : "Alt+→",
      available: () => enabledToolbarControl("Forward"),
      run: () => isMac ? dispatchShortcut("]") : dispatchAltKey("ArrowRight"),
    },
    {
      id: "navigation.parent",
      title: "Go to Parent Folder",
      category: "Navigation",
      shortcut: isMac ? "⌘↑" : "Alt+↑",
      available: () => enabledToolbarControl("Up"),
      run: () => isMac ? dispatchShortcut("ArrowUp") : dispatchAltKey("ArrowUp"),
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

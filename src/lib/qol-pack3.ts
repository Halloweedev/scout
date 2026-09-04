import { copyEntries, moveEntries } from "./fs";
import { registerActions, type ScoutActionContext } from "./actions";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function toast(message: string) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message } }));
}

async function copyText(value: string, message: string) {
  await navigator.clipboard.writeText(value);
  toast(message);
}

function parentPath(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return path;
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.slice(0, index);
}

function stem(name: string) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

function extension(name: string) {
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1) : "";
}

function fileUri(path: string) {
  if (/^[A-Za-z]:[\\/]/.test(path)) return `file:///${encodeURI(path.replace(/\\/g, "/"))}`;
  return `file://${encodeURI(path)}`;
}

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

function activeRows() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row")]
    .filter((row) => row.offsetParent !== null && !!row.dataset.entryPath);
}

function hasVisibleKind(kind: "directory" | "file") {
  return activeRows().some((row) => kind === "directory"
    ? row.dataset.entryKind === "directory"
    : row.dataset.entryKind !== "directory");
}

function clearSelection() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function selectRows(predicate: (row: HTMLElement) => boolean, label: string) {
  const rows = activeRows().filter(predicate);
  if (!rows.length) throw new Error(`No ${label.toLocaleLowerCase()} are visible`);
  clearSelection();
  queueMicrotask(() => {
    for (const row of rows) {
      row.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        metaKey: isMac,
        ctrlKey: !isMac,
      }));
    }
    toast(`Selected ${rows.length} ${label.toLocaleLowerCase()}`);
  });
}

function single(context: ScoutActionContext) {
  return context.selection.length === 1;
}

function singleFile(context: ScoutActionContext) {
  return context.selection.length === 1 && context.selection[0].kind !== "directory";
}

function navigateParent(context: ScoutActionContext) {
  const entry = context.selection[0];
  if (!entry) throw new Error("Select one item");
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: parentPath(entry.path) } }));
}

function panes() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane")]
    .filter((pane) => pane.offsetParent !== null && !!pane.dataset.panePath);
}

function otherPanePath() {
  const visible = panes();
  if (visible.length < 2) return null;
  const active = visible.findIndex((pane) => pane.classList.contains("active"));
  const next = visible[(Math.max(active, 0) + 1) % visible.length];
  return next?.dataset.panePath ?? null;
}

function hasDistinctOtherPane(context: ScoutActionContext) {
  const destination = otherPanePath();
  return !!destination && !!context.panePath && comparablePath(destination) !== comparablePath(context.panePath);
}

async function transferToOtherPane(context: ScoutActionContext, mode: "copy" | "move") {
  const destination = otherPanePath();
  if (!destination) throw new Error("Add another pane first");
  if (!context.selectedPaths.length) throw new Error("Select one or more items first");
  if (mode === "move" && context.panePath && comparablePath(destination) === comparablePath(context.panePath)) {
    throw new Error("The next pane is already showing this folder");
  }
  if (mode === "copy") await copyEntries(context.selectedPaths, destination);
  else await moveEntries(context.selectedPaths, destination);
  toast(`${mode === "copy" ? "Copied" : "Moved"} ${context.selectedPaths.length} item${context.selectedPaths.length === 1 ? "" : "s"} to the next pane`);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }));
}

function sameExtension(context: ScoutActionContext) {
  const entry = context.selection[0];
  const ext = (entry?.extension ?? extension(entry?.name ?? "")).toLocaleLowerCase();
  if (!ext) throw new Error("The selected file has no extension");
  selectRows((row) => (row.dataset.entryExtension ?? "").toLocaleLowerCase() === ext, `.${ext} files`);
}

function sameKind(context: ScoutActionContext) {
  const kind = context.selection[0]?.kind;
  if (!kind) throw new Error("Select one item first");
  selectRows((row) => row.dataset.entryKind === kind, kind === "directory" ? "folders" : `${kind} items`);
}

export function installQolPack3() {
  return registerActions([
    {
      id: "file.copy-parent-path",
      title: "Copy Parent Folder Path",
      category: "File",
      keywords: ["parent", "directory", "clipboard", "location"],
      contextMenu: true,
      contextMenuOrder: 24,
      available: single,
      run: (context) => copyText(parentPath(context.selection[0].path), "Copied parent folder path"),
    },
    {
      id: "file.copy-stem",
      title: "Copy Filename Without Extension",
      category: "File",
      keywords: ["stem", "basename", "clipboard"],
      available: singleFile,
      run: (context) => copyText(stem(context.selection[0].name), "Copied filename stem"),
    },
    {
      id: "file.copy-extension",
      title: "Copy File Extension",
      category: "File",
      keywords: ["suffix", "type", "clipboard"],
      available: (context) => singleFile(context) && !!(context.selection[0].extension || extension(context.selection[0].name)),
      run: (context) => copyText(context.selection[0].extension || extension(context.selection[0].name), "Copied extension"),
    },
    {
      id: "file.copy-markdown-link",
      title: "Copy as Markdown Link",
      category: "Developer",
      keywords: ["markdown", "link", "uri", "clipboard"],
      available: single,
      run: (context) => {
        const entry = context.selection[0];
        return copyText(`[${entry.name}](${fileUri(entry.path)})`, "Copied Markdown link");
      },
    },
    {
      id: "file.reveal-parent",
      title: "Go to Parent Folder of Selection",
      category: "Navigation",
      keywords: ["reveal", "containing folder", "parent"],
      contextMenu: true,
      contextMenuOrder: 7,
      available: single,
      run: navigateParent,
    },
    {
      id: "file.copy-other-pane",
      title: "Copy to Next Pane",
      category: "File",
      subtitle: "Copy the current selection to the next visible pane",
      keywords: ["copy", "pane", "split", "other pane"],
      contextMenu: true,
      contextMenuOrder: 36,
      available: (context) => context.selectedPaths.length > 0 && !!otherPanePath(),
      run: (context) => transferToOtherPane(context, "copy"),
    },
    {
      id: "file.move-other-pane",
      title: "Move to Next Pane",
      category: "File",
      subtitle: "Move the current selection to the next visible pane",
      keywords: ["move", "pane", "split", "other pane"],
      contextMenu: true,
      contextMenuOrder: 37,
      available: (context) => context.selectedPaths.length > 0 && hasDistinctOtherPane(context),
      run: (context) => transferToOtherPane(context, "move"),
    },
    {
      id: "selection.same-extension",
      title: "Select Files with Same Extension",
      category: "Selection",
      keywords: ["select similar", "extension", "file type"],
      available: (context) => singleFile(context) && !!(context.selection[0].extension || extension(context.selection[0].name)),
      run: sameExtension,
    },
    {
      id: "selection.same-kind",
      title: "Select Items of Same Kind",
      category: "Selection",
      keywords: ["folders", "files", "select similar", "kind"],
      available: single,
      run: sameKind,
    },
    {
      id: "selection.folders",
      title: "Select All Folders",
      category: "Selection",
      keywords: ["directories", "folders only"],
      available: (context) => !!context.panePath && hasVisibleKind("directory"),
      run: () => selectRows((row) => row.dataset.entryKind === "directory", "folders"),
    },
    {
      id: "selection.files",
      title: "Select All Files",
      category: "Selection",
      keywords: ["files only", "exclude folders"],
      available: (context) => !!context.panePath && hasVisibleKind("file"),
      run: () => selectRows((row) => row.dataset.entryKind !== "directory", "files"),
    },
  ]);
}

import { listen } from "@tauri-apps/api/event";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import Icon, { type IconName } from "./components/Icon";
import {
  copyEntries,
  createFolder,
  duplicateEntries,
  getSpecialDirectories,
  listDirectory,
  moveEntries,
  openEntry,
  renameEntry,
  trashEntries,
  watchDirectory,
} from "./lib/fs";
import type { ClipboardState, DirectoryListing, ExplorerTab, FsEntry, SpecialDirectories } from "./types";

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
}

interface SidebarItem {
  label: string;
  path: string;
  icon: IconName;
}

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function formatBytes(value: number | null) {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

function formatModified(value: number | null) {
  if (value === null) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function App() {
  const [special, setSpecial] = createSignal<SpecialDirectories | null>(null);
  const [listing, setListing] = createSignal<DirectoryListing | null>(null);
  const [tabs, setTabs] = createSignal<ExplorerTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal("");
  const [selected, setSelected] = createSignal<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = createSignal<number | null>(null);
  const [showHidden, setShowHidden] = createSignal(false);
  const [clipboard, setClipboard] = createSignal<ClipboardState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [renamePath, setRenamePath] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  let stopFilesystemListener: (() => void) | undefined;
  let refreshTimer: number | undefined;

  const activeTab = createMemo(() => tabs().find((tab) => tab.id === activeTabId()) ?? null);
  const entries = createMemo(() => listing()?.entries ?? []);
  const canGoBack = createMemo(() => (activeTab()?.historyIndex ?? 0) > 0);
  const canGoForward = createMemo(() => {
    const tab = activeTab();
    return !!tab && tab.historyIndex < tab.history.length - 1;
  });

  const sidebarItems = createMemo<SidebarItem[]>(() => {
    const dirs = special();
    if (!dirs) return [];
    const items: SidebarItem[] = [{ label: "Home", path: dirs.home, icon: "home" }];
    if (dirs.desktop) items.push({ label: "Desktop", path: dirs.desktop, icon: "desktop" });
    if (dirs.documents) items.push({ label: "Documents", path: dirs.documents, icon: "document" });
    if (dirs.downloads) items.push({ label: "Downloads", path: dirs.downloads, icon: "download" });
    return items;
  });

  function updateActiveTab(mutator: (tab: ExplorerTab) => ExplorerTab) {
    const id = activeTabId();
    setTabs((current) => current.map((tab) => (tab.id === id ? mutator(tab) : tab)));
  }

  async function load(path: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await listDirectory(path, showHidden());
      await watchDirectory(next.path);
      setListing(next);
      setSelected([]);
      setSelectionAnchor(null);
      return next;
    } catch (reason) {
      setError(String(reason));
      throw reason;
    } finally {
      setLoading(false);
    }
  }

  async function navigate(path: string, pushHistory = true) {
    const next = await load(path);
    updateActiveTab((tab) => {
      if (!pushHistory) return { ...tab, path: next.path, title: next.displayName };
      const history = [...tab.history.slice(0, tab.historyIndex + 1), next.path];
      return { ...tab, path: next.path, title: next.displayName, history, historyIndex: history.length - 1 };
    });
  }

  async function reload() {
    const path = activeTab()?.path;
    if (path) await load(path);
  }

  function scheduleFilesystemRefresh() {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void reload();
    }, 120);
  }

  async function goHistory(delta: number) {
    const tab = activeTab();
    if (!tab) return;
    const nextIndex = tab.historyIndex + delta;
    const path = tab.history[nextIndex];
    if (!path) return;
    const next = await load(path);
    updateActiveTab((current) => ({ ...current, path: next.path, title: next.displayName, historyIndex: nextIndex }));
  }

  async function switchTab(id: string) {
    const tab = tabs().find((candidate) => candidate.id === id);
    if (!tab || id === activeTabId()) return;
    setActiveTabId(id);
    setRenamePath(null);
    await load(tab.path);
  }

  async function newTab() {
    const path = activeTab()?.path ?? special()?.home;
    if (!path) return;
    const id = makeId();
    const tab: ExplorerTab = { id, title: "Scout", path, history: [path], historyIndex: 0 };
    setTabs((current) => [...current, tab]);
    setActiveTabId(id);
    const next = await load(path);
    updateActiveTab((current) => ({ ...current, title: next.displayName, path: next.path, history: [next.path], historyIndex: 0 }));
  }

  async function closeTab(id: string) {
    const current = tabs();
    if (current.length <= 1) return;
    const index = current.findIndex((tab) => tab.id === id);
    const remaining = current.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (id === activeTabId()) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActiveTabId(next.id);
      await load(next.path);
    }
  }

  function selectEntry(event: MouseEvent, entry: FsEntry, index: number) {
    const modifier = event.metaKey || event.ctrlKey;
    const anchor = selectionAnchor();
    if (event.shiftKey && anchor !== null) {
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      setSelected(entries().slice(from, to + 1).map((item) => item.path));
      return;
    }
    if (modifier) {
      setSelected((current) => current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path]);
      setSelectionAnchor(index);
      return;
    }
    setSelected([entry.path]);
    setSelectionAnchor(index);
  }

  async function activateEntry(entry: FsEntry) {
    if (entry.kind === "directory") await navigate(entry.path);
    else await openEntry(entry.path);
  }

  function startRename(path: string) {
    const entry = entries().find((candidate) => candidate.path === path);
    if (!entry) return;
    setRenamePath(path);
    setRenameValue(entry.name);
    setContextMenu(null);
    queueMicrotask(() => document.querySelector<HTMLInputElement>(".rename-input")?.select());
  }

  async function commitRename() {
    const path = renamePath();
    const nextName = renameValue().trim();
    if (!path || !nextName) {
      setRenamePath(null);
      return;
    }
    try {
      await renameEntry(path, nextName);
      setRenamePath(null);
      await reload();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function duplicateSelection() {
    if (!selected().length) return;
    try {
      await duplicateEntries(selected());
      setContextMenu(null);
      await reload();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function trashSelection() {
    if (!selected().length) return;
    try {
      await trashEntries(selected());
      setContextMenu(null);
      await reload();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function paste(destination = activeTab()?.path) {
    const payload = clipboard();
    if (!payload || !destination) return;
    try {
      if (payload.mode === "copy") await copyEntries(payload.paths, destination);
      else {
        await moveEntries(payload.paths, destination);
        setClipboard(null);
      }
      await reload();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function makeFolder() {
    const path = activeTab()?.path;
    if (!path) return;
    try {
      const folder = await createFolder(path);
      await reload();
      setSelected([folder.path]);
      startRename(folder.path);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function toggleHiddenFiles() {
    setShowHidden((value) => !value);
    await reload();
  }

  function moveKeyboardSelection(delta: number) {
    const list = entries();
    if (!list.length) return;
    const currentIndex = selected().length ? list.findIndex((entry) => entry.path === selected()[0]) : -1;
    const nextIndex = Math.min(Math.max(currentIndex + delta, 0), list.length - 1);
    setSelected([list[nextIndex].path]);
    setSelectionAnchor(nextIndex);
    document.querySelector<HTMLElement>(`[data-entry-index="${nextIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }

  async function handleKeyDown(event: KeyboardEvent) {
    if (renamePath()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "c" && selected().length) {
      event.preventDefault();
      setClipboard({ mode: "copy", paths: selected() });
    } else if (modifier && key === "x" && selected().length) {
      event.preventDefault();
      setClipboard({ mode: "move", paths: selected() });
    } else if (modifier && key === "v") {
      event.preventDefault();
      await paste();
    } else if (modifier && key === "d") {
      event.preventDefault();
      await duplicateSelection();
    } else if (modifier && key === "t") {
      event.preventDefault();
      await newTab();
    } else if (modifier && key === "w") {
      event.preventDefault();
      await closeTab(activeTabId());
    } else if (modifier && event.shiftKey && event.key === ".") {
      event.preventDefault();
      await toggleHiddenFiles();
    } else if (event.key === "F2" && selected()[0]) {
      event.preventDefault();
      startRename(selected()[0]);
    } else if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) {
      event.preventDefault();
      await trashSelection();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveKeyboardSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveKeyboardSelection(-1);
    } else if (event.key === "Enter" && selected()[0]) {
      const entry = entries().find((candidate) => candidate.path === selected()[0]);
      if (entry) await activateEntry(entry);
    }
  }

  function handleDragStart(event: DragEvent, entry: FsEntry) {
    if (!selected().includes(entry.path)) setSelected([entry.path]);
    const paths = selected().includes(entry.path) ? selected() : [entry.path];
    event.dataTransfer?.setData("application/x-scout-paths", JSON.stringify(paths));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  async function handleDrop(event: DragEvent, destination: string) {
    event.preventDefault();
    const raw = event.dataTransfer?.getData("application/x-scout-paths");
    if (!raw) return;
    try {
      const paths = JSON.parse(raw) as string[];
      await moveEntries(paths, destination);
      await reload();
    } catch (reason) {
      setError(String(reason));
    }
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  onMount(async () => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", closeContextMenu);
    try {
      stopFilesystemListener = await listen("scout-fs-change", scheduleFilesystemRefresh);
      const dirs = await getSpecialDirectories();
      setSpecial(dirs);
      const first = await listDirectory(dirs.home, showHidden());
      await watchDirectory(first.path);
      const id = makeId();
      setTabs([{ id, title: first.displayName, path: first.path, history: [first.path], historyIndex: 0 }]);
      setActiveTabId(id);
      setListing(first);
    } catch (reason) {
      setError(String(reason));
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("click", closeContextMenu);
    stopFilesystemListener?.();
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  });

  return (
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-row"><Icon name="scout" size={18} /><span>Scout</span></div>
        <div class="sidebar-section-label">Places</div>
        <nav class="sidebar-nav">
          <For each={sidebarItems()}>{(item) => (
            <button class="sidebar-item" classList={{ active: activeTab()?.path === item.path }} onClick={() => navigate(item.path)}>
              <Icon name={item.icon} size={15} /><span>{item.label}</span>
            </button>
          )}</For>
        </nav>
        <div class="sidebar-spacer" />
        <div class="sidebar-footer">GPLv3 · local-first</div>
      </aside>

      <section class="workspace">
        <header class="toolbar">
          <div class="toolbar-group">
            <button class="icon-button" disabled={!canGoBack()} onClick={() => goHistory(-1)} aria-label="Back"><Icon name="arrow-left" /></button>
            <button class="icon-button" disabled={!canGoForward()} onClick={() => goHistory(1)} aria-label="Forward"><Icon name="arrow-right" /></button>
            <button class="icon-button" disabled={!listing()?.parentPath} onClick={() => { const parent = listing()?.parentPath; if (parent) void navigate(parent); }} aria-label="Up"><Icon name="arrow-up" /></button>
          </div>
          <div class="path-display" title={activeTab()?.path ?? ""}>{activeTab()?.path ?? "Loading…"}</div>
          <div class="toolbar-group toolbar-actions">
            <button class="icon-button" classList={{ active: showHidden() }} onClick={toggleHiddenFiles} aria-label="Show hidden files"><Icon name="eye" /></button>
            <button class="icon-button" onClick={makeFolder} aria-label="New folder"><Icon name="new-folder" /></button>
          </div>
        </header>

        <div class="tab-strip">
          <For each={tabs()}>{(tab) => (
            <button class="tab" classList={{ active: tab.id === activeTabId() }} onClick={() => switchTab(tab.id)}>
              <Icon name="folder" size={13} /><span>{tab.title}</span>
              <Show when={tabs().length > 1}><span class="tab-close" role="button" onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}><Icon name="close" size={12} /></span></Show>
            </button>
          )}</For>
          <button class="new-tab-button" onClick={newTab} aria-label="New tab"><Icon name="plus" size={14} /></button>
        </div>

        <main
          class="file-area"
          classList={{ loading: loading() }}
          onClick={(event) => { if (event.target === event.currentTarget) setSelected([]); }}
          onDragOver={(event) => { if (event.dataTransfer?.types.includes("application/x-scout-paths")) event.preventDefault(); }}
          onDrop={(event) => { const path = activeTab()?.path; if (path) void handleDrop(event, path); }}
        >
          <div class="file-header"><div>Name</div><div>Modified</div><div class="size-cell">Size</div></div>
          <div class="file-list">
            <For each={entries()}>{(entry, index) => (
              <div
                class="file-row"
                classList={{ selected: selected().includes(entry.path), cut: clipboard()?.mode === "move" && !!clipboard()?.paths.includes(entry.path) }}
                data-entry-index={index()}
                draggable
                onClick={(event) => { event.stopPropagation(); selectEntry(event, entry, index()); }}
                onDblClick={() => activateEntry(entry)}
                onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!selected().includes(entry.path)) setSelected([entry.path]); setContextMenu({ x: event.clientX, y: event.clientY, path: entry.path }); }}
                onDragStart={(event) => handleDragStart(event, entry)}
                onDragOver={(event) => { if (entry.kind === "directory") event.preventDefault(); }}
                onDrop={(event) => { event.stopPropagation(); if (entry.kind === "directory") void handleDrop(event, entry.path); }}
              >
                <div class="name-cell">
                  <span class="file-icon"><Icon name={entry.kind === "directory" ? "folder" : "file"} size={17} /></span>
                  <Show when={renamePath() === entry.path} fallback={<span class="file-name">{entry.name}</span>}>
                    <input
                      class="rename-input"
                      value={renameValue()}
                      onInput={(event) => setRenameValue(event.currentTarget.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") void commitRename(); if (event.key === "Escape") setRenamePath(null); }}
                      onBlur={() => commitRename()}
                    />
                  </Show>
                </div>
                <div class="muted-cell">{formatModified(entry.modifiedMs)}</div>
                <div class="muted-cell size-cell">{entry.kind === "directory" ? "—" : formatBytes(entry.size)}</div>
              </div>
            )}</For>
          </div>
          <Show when={!loading() && entries().length === 0}><div class="empty-state">This folder is empty.</div></Show>
        </main>

        <footer class="statusbar">
          <span>{entries().length} {entries().length === 1 ? "item" : "items"}</span>
          <Show when={selected().length}><span>{selected().length} selected</span></Show>
          <Show when={clipboard()}>{(payload) => <span>{payload().mode === "copy" ? "Copied" : "Cut"} {payload().paths.length}</span>}</Show>
          <Show when={error()}>{(message) => <span class="status-error" title={message()}>{message()}</span>}</Show>
        </footer>
      </section>

      <Show when={contextMenu()}>{(menu) => (
        <div class="context-menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }} onClick={(event) => event.stopPropagation()}>
          <button onClick={() => { setClipboard({ mode: "copy", paths: selected() }); setContextMenu(null); }}><Icon name="copy" size={14} />Copy</button>
          <button onClick={() => { setClipboard({ mode: "move", paths: selected() }); setContextMenu(null); }}>Cut</button>
          <button onClick={() => startRename(menu().path)}>Rename <kbd>F2</kbd></button>
          <button onClick={duplicateSelection}>Duplicate <kbd>⌘D</kbd></button>
          <div class="menu-separator" />
          <button class="danger" onClick={trashSelection}><Icon name="trash" size={14} />Move to Trash</button>
        </div>
      )}</Show>
    </div>
  );
}

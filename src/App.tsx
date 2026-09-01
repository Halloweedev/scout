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
  setActiveListing,
  trashEntries,
  watchDirectory,
} from "./lib/fs";
import type { ClipboardState, DirectoryListing, ExplorerTab, FsEntry, SpecialDirectories } from "./types";

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  paneId: string;
}

interface SidebarItem {
  label: string;
  path: string;
  icon: IconName;
}

interface PaneState {
  id: string;
  title: string;
  path: string;
  listing: DirectoryListing | null;
  history: string[];
  historyIndex: number;
  selected: string[];
  selectionAnchor: number | null;
  loading: boolean;
  error: string | null;
}

interface LoadPaneOptions {
  pushHistory?: boolean;
  historyIndex?: number;
  resetHistory?: boolean;
  syncTab?: boolean;
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

function paneFromListing(listing: DirectoryListing): PaneState {
  return {
    id: makeId(),
    title: listing.displayName,
    path: listing.path,
    listing,
    history: [listing.path],
    historyIndex: 0,
    selected: [],
    selectionAnchor: null,
    loading: false,
    error: null,
  };
}

export default function App() {
  const [special, setSpecial] = createSignal<SpecialDirectories | null>(null);
  const [tabs, setTabs] = createSignal<ExplorerTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal("");
  const [panes, setPanes] = createSignal<PaneState[]>([]);
  const [activePaneId, setActivePaneId] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [clipboard, setClipboard] = createSignal<ClipboardState | null>(null);
  const [renamePath, setRenamePath] = createSignal<string | null>(null);
  const [renamePaneId, setRenamePaneId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  let stopFilesystemListener: (() => void) | undefined;
  let refreshTimer: number | undefined;

  const activeTab = createMemo(() => tabs().find((tab) => tab.id === activeTabId()) ?? null);
  const activePane = createMemo(() => panes().find((pane) => pane.id === activePaneId()) ?? null);
  const activeEntries = createMemo(() => activePane()?.listing?.entries ?? []);
  const activeSelected = createMemo(() => activePane()?.selected ?? []);
  const canGoBack = createMemo(() => (activePane()?.historyIndex ?? 0) > 0);
  const canGoForward = createMemo(() => {
    const pane = activePane();
    return !!pane && pane.historyIndex < pane.history.length - 1;
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

  function paneById(id: string) {
    return panes().find((pane) => pane.id === id) ?? null;
  }

  function updatePane(id: string, mutator: (pane: PaneState) => PaneState) {
    setPanes((current) => current.map((pane) => (pane.id === id ? mutator(pane) : pane)));
  }

  function updateActiveTab(mutator: (tab: ExplorerTab) => ExplorerTab) {
    const id = activeTabId();
    setTabs((current) => current.map((tab) => (tab.id === id ? mutator(tab) : tab)));
  }

  function syncTabToPane(pane: PaneState) {
    updateActiveTab((tab) => ({ ...tab, path: pane.path, title: pane.title }));
  }

  function focusPane(id: string) {
    const pane = paneById(id);
    if (!pane) return;
    setActivePaneId(id);
    setActiveListing(pane.listing);
    syncTabToPane(pane);
    void watchDirectory(pane.path).catch((reason) => {
      updatePane(id, (current) => ({ ...current, error: String(reason) }));
    });
  }

  async function loadPane(id: string, path: string, options: LoadPaneOptions = {}) {
    const current = paneById(id);
    if (!current) return null;

    updatePane(id, (pane) => ({ ...pane, loading: true, error: null }));
    try {
      const listing = await listDirectory(path, showHidden());
      const pushHistory = options.pushHistory ?? true;
      let history = current.history;
      let historyIndex = current.historyIndex;

      if (options.resetHistory) {
        history = [listing.path];
        historyIndex = 0;
      } else if (options.historyIndex !== undefined) {
        historyIndex = options.historyIndex;
      } else if (pushHistory) {
        history = [...current.history.slice(0, current.historyIndex + 1), listing.path];
        historyIndex = history.length - 1;
      }

      const nextPane: PaneState = {
        ...current,
        title: listing.displayName,
        path: listing.path,
        listing,
        history,
        historyIndex,
        selected: [],
        selectionAnchor: null,
        loading: false,
        error: null,
      };
      updatePane(id, () => nextPane);

      if (id === activePaneId()) {
        setActiveListing(listing);
        await watchDirectory(listing.path);
        if (options.syncTab !== false) syncTabToPane(nextPane);
      }
      return nextPane;
    } catch (reason) {
      updatePane(id, (pane) => ({ ...pane, loading: false, error: String(reason) }));
      return null;
    }
  }

  async function navigate(path: string) {
    const id = activePaneId();
    if (id) await loadPane(id, path);
  }

  async function reloadPane(id: string) {
    const pane = paneById(id);
    if (pane) await loadPane(id, pane.path, { pushHistory: false });
  }

  async function reloadActivePane() {
    const id = activePaneId();
    if (id) await reloadPane(id);
  }

  function scheduleFilesystemRefresh() {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void reloadActivePane();
    }, 120);
  }

  async function goHistory(delta: number) {
    const pane = activePane();
    if (!pane) return;
    const nextIndex = pane.historyIndex + delta;
    const path = pane.history[nextIndex];
    if (!path) return;
    await loadPane(pane.id, path, { pushHistory: false, historyIndex: nextIndex });
  }

  async function switchTab(id: string) {
    const tab = tabs().find((candidate) => candidate.id === id);
    const pane = activePane();
    if (!tab || !pane || id === activeTabId()) return;
    setActiveTabId(id);
    setRenamePath(null);
    setRenamePaneId(null);
    await loadPane(pane.id, tab.path, { pushHistory: false, resetHistory: true, syncTab: false });
  }

  async function newTab() {
    const pane = activePane();
    const path = pane?.path ?? special()?.home;
    if (!path) return;
    const id = makeId();
    setTabs((current) => [...current, { id, title: pane?.title ?? "Scout", path, history: [path], historyIndex: 0 }]);
    setActiveTabId(id);
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
      const pane = activePane();
      if (pane) await loadPane(pane.id, next.path, { pushHistory: false, resetHistory: true, syncTab: false });
    }
  }

  async function addPane() {
    if (panes().length >= 4) return;
    const source = activePane();
    const path = source?.path ?? special()?.home;
    if (!path) return;
    try {
      const listing = await listDirectory(path, showHidden());
      const pane = paneFromListing(listing);
      setPanes((current) => [...current, pane]);
      setActivePaneId(pane.id);
      setActiveListing(listing);
      syncTabToPane(pane);
      await watchDirectory(listing.path);
    } catch (reason) {
      if (source) updatePane(source.id, (pane) => ({ ...pane, error: String(reason) }));
    }
  }

  function removePane(id = activePaneId()) {
    const current = panes();
    if (current.length <= 1) return;
    const index = current.findIndex((pane) => pane.id === id);
    if (index < 0) return;
    const remaining = current.filter((pane) => pane.id !== id);
    setPanes(remaining);
    if (id === activePaneId()) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActivePaneId(next.id);
      setActiveListing(next.listing);
      syncTabToPane(next);
      void watchDirectory(next.path);
    }
  }

  function selectEntry(event: MouseEvent, paneId: string, entry: FsEntry, index: number) {
    focusPane(paneId);
    const pane = paneById(paneId);
    if (!pane) return;
    const modifier = event.metaKey || event.ctrlKey;
    const anchor = pane.selectionAnchor;
    const entries = pane.listing?.entries ?? [];

    if (event.shiftKey && anchor !== null) {
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      updatePane(paneId, (current) => ({
        ...current,
        selected: entries.slice(from, to + 1).map((item) => item.path),
      }));
      return;
    }

    if (modifier) {
      updatePane(paneId, (current) => ({
        ...current,
        selected: current.selected.includes(entry.path)
          ? current.selected.filter((path) => path !== entry.path)
          : [...current.selected, entry.path],
        selectionAnchor: index,
      }));
      return;
    }

    updatePane(paneId, (current) => ({ ...current, selected: [entry.path], selectionAnchor: index }));
  }

  async function activateEntry(paneId: string, entry: FsEntry) {
    focusPane(paneId);
    if (entry.kind === "directory") await loadPane(paneId, entry.path);
    else await openEntry(entry.path);
  }

  function startRename(paneId: string, path: string) {
    const pane = paneById(paneId);
    const entry = pane?.listing?.entries.find((candidate) => candidate.path === path);
    if (!entry) return;
    focusPane(paneId);
    setRenamePaneId(paneId);
    setRenamePath(path);
    setRenameValue(entry.name);
    setContextMenu(null);
    queueMicrotask(() => document.querySelector<HTMLInputElement>(`.explorer-pane.active .rename-input`)?.select());
  }

  async function commitRename() {
    const path = renamePath();
    const paneId = renamePaneId();
    const nextName = renameValue().trim();
    if (!path || !paneId || !nextName) {
      setRenamePath(null);
      setRenamePaneId(null);
      return;
    }
    try {
      await renameEntry(path, nextName);
      setRenamePath(null);
      setRenamePaneId(null);
      await reloadPane(paneId);
    } catch (reason) {
      updatePane(paneId, (pane) => ({ ...pane, error: String(reason) }));
    }
  }

  async function duplicateSelection() {
    const pane = activePane();
    if (!pane?.selected.length) return;
    try {
      await duplicateEntries(pane.selected);
      setContextMenu(null);
      await reloadPane(pane.id);
    } catch (reason) {
      updatePane(pane.id, (current) => ({ ...current, error: String(reason) }));
    }
  }

  async function trashSelection() {
    const pane = activePane();
    if (!pane?.selected.length) return;
    try {
      await trashEntries(pane.selected);
      setContextMenu(null);
      await reloadPane(pane.id);
    } catch (reason) {
      updatePane(pane.id, (current) => ({ ...current, error: String(reason) }));
    }
  }

  async function paste(destination = activePane()?.path, paneId = activePaneId()) {
    const payload = clipboard();
    if (!payload || !destination || !paneId) return;
    try {
      if (payload.mode === "copy") await copyEntries(payload.paths, destination);
      else {
        await moveEntries(payload.paths, destination);
        setClipboard(null);
      }
      await reloadPane(paneId);
    } catch (reason) {
      updatePane(paneId, (pane) => ({ ...pane, error: String(reason) }));
    }
  }

  async function makeFolder() {
    const pane = activePane();
    if (!pane) return;
    try {
      const folder = await createFolder(pane.path);
      await reloadPane(pane.id);
      updatePane(pane.id, (current) => ({ ...current, selected: [folder.path] }));
      startRename(pane.id, folder.path);
    } catch (reason) {
      updatePane(pane.id, (current) => ({ ...current, error: String(reason) }));
    }
  }

  async function toggleHiddenFiles() {
    setShowHidden((value) => !value);
    await Promise.all(panes().map((pane) => reloadPane(pane.id)));
  }

  function moveKeyboardSelection(delta: number) {
    const pane = activePane();
    const entries = pane?.listing?.entries ?? [];
    if (!pane || !entries.length) return;
    const currentIndex = pane.selected.length ? entries.findIndex((entry) => entry.path === pane.selected[0]) : -1;
    const nextIndex = Math.min(Math.max(currentIndex + delta, 0), entries.length - 1);
    updatePane(pane.id, (current) => ({ ...current, selected: [entries[nextIndex].path], selectionAnchor: nextIndex }));
    document.querySelector<HTMLElement>(`.explorer-pane.active [data-entry-index="${nextIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }

  async function handleKeyDown(event: KeyboardEvent) {
    if (renamePath()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const selected = activeSelected();

    if (modifier && key === "c" && selected.length) {
      event.preventDefault();
      setClipboard({ mode: "copy", paths: selected });
    } else if (modifier && key === "x" && selected.length) {
      event.preventDefault();
      setClipboard({ mode: "move", paths: selected });
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
    } else if (event.key === "F2" && selected[0]) {
      event.preventDefault();
      startRename(activePaneId(), selected[0]);
    } else if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) {
      event.preventDefault();
      await trashSelection();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveKeyboardSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveKeyboardSelection(-1);
    } else if (event.key === "Enter" && selected[0]) {
      const entry = activeEntries().find((candidate) => candidate.path === selected[0]);
      const pane = activePane();
      if (entry && pane) await activateEntry(pane.id, entry);
    }
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function handleScoutNavigate(event: Event) {
    const path = (event as CustomEvent<{ path?: string }>).detail?.path;
    if (path) void navigate(path);
  }

  onMount(async () => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scout:navigate", handleScoutNavigate);
    try {
      stopFilesystemListener = await listen("scout-fs-change", scheduleFilesystemRefresh);
      const dirs = await getSpecialDirectories();
      setSpecial(dirs);
      const first = await listDirectory(dirs.home, showHidden());
      const pane = paneFromListing(first);
      const tabId = makeId();
      setPanes([pane]);
      setActivePaneId(pane.id);
      setTabs([{ id: tabId, title: first.displayName, path: first.path, history: [first.path], historyIndex: 0 }]);
      setActiveTabId(tabId);
      setActiveListing(first);
      await watchDirectory(first.path);
    } catch (reason) {
      const pane = activePane();
      if (pane) updatePane(pane.id, (current) => ({ ...current, error: String(reason) }));
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("click", closeContextMenu);
    window.removeEventListener("scout:navigate", handleScoutNavigate);
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
            <button class="sidebar-item" classList={{ active: activePane()?.path === item.path }} onClick={() => navigate(item.path)}>
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
            <button class="icon-button" disabled={!activePane()?.listing?.parentPath} onClick={() => { const parent = activePane()?.listing?.parentPath; if (parent) void navigate(parent); }} aria-label="Up"><Icon name="arrow-up" /></button>
          </div>
          <div class="path-display" title={activePane()?.path ?? ""}>{activePane()?.path ?? "Loading…"}</div>
          <div class="toolbar-group toolbar-actions">
            <button class="icon-button" disabled={panes().length >= 4} onClick={addPane} aria-label="Add pane" title="Add pane"><Icon name="split" /></button>
            <button class="icon-button" disabled={panes().length <= 1} onClick={() => removePane()} aria-label="Close active pane" title="Close active pane"><Icon name="close" /></button>
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

        <div class={`pane-grid panes-${panes().length}`}>
          <For each={panes()}>{(pane) => (
            <section
              class="explorer-pane"
              classList={{ active: pane.id === activePaneId() }}
              data-pane-path={pane.path}
              onPointerDown={() => focusPane(pane.id)}
            >
              <div class="pane-chrome">
                <span class="pane-path" title={pane.path}>{pane.path}</span>
                <Show when={panes().length > 1}>
                  <button class="pane-close-button" onClick={(event) => { event.stopPropagation(); removePane(pane.id); }} aria-label="Close pane"><Icon name="close" size={12} /></button>
                </Show>
              </div>
              <main
                class="file-area"
                classList={{ loading: pane.loading }}
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    focusPane(pane.id);
                    updatePane(pane.id, (current) => ({ ...current, selected: [], selectionAnchor: null }));
                  }
                }}
              >
                <div class="file-header"><div>Name</div><div>Modified</div><div class="size-cell">Size</div></div>
                <div class="file-list">
                  <For each={pane.listing?.entries ?? []}>{(entry, index) => (
                    <div
                      class="pane-file-row"
                      classList={{
                        "file-row": pane.id === activePaneId(),
                        selected: pane.selected.includes(entry.path),
                        cut: clipboard()?.mode === "move" && !!clipboard()?.paths.includes(entry.path),
                      }}
                      data-entry-index={index()}
                      data-entry-path={entry.path}
                      data-entry-name={entry.name}
                      data-entry-kind={entry.kind}
                      data-entry-extension={entry.extension ?? ""}
                      data-entry-modified={entry.modifiedMs ?? ""}
                      onClick={(event) => { event.stopPropagation(); selectEntry(event, pane.id, entry, index()); }}
                      onDblClick={() => activateEntry(pane.id, entry)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        focusPane(pane.id);
                        if (!pane.selected.includes(entry.path)) updatePane(pane.id, (current) => ({ ...current, selected: [entry.path], selectionAnchor: index() }));
                        setContextMenu({ x: event.clientX, y: event.clientY, path: entry.path, paneId: pane.id });
                      }}
                    >
                      <div class="name-cell">
                        <span class="file-icon"><Icon name={entry.kind === "directory" ? "folder" : "file"} size={17} /></span>
                        <Show when={renamePaneId() === pane.id && renamePath() === entry.path} fallback={<span class="file-name">{entry.name}</span>}>
                          <input
                            class="rename-input"
                            value={renameValue()}
                            onInput={(event) => setRenameValue(event.currentTarget.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") void commitRename(); if (event.key === "Escape") { setRenamePath(null); setRenamePaneId(null); } }}
                            onBlur={() => commitRename()}
                          />
                        </Show>
                      </div>
                      <div class="muted-cell">{formatModified(entry.modifiedMs)}</div>
                      <div class="muted-cell size-cell">{entry.kind === "directory" ? "—" : formatBytes(entry.size)}</div>
                    </div>
                  )}</For>
                </div>
                <Show when={!pane.loading && (pane.listing?.entries.length ?? 0) === 0}><div class="empty-state">This folder is empty.</div></Show>
              </main>
            </section>
          )}</For>
        </div>

        <footer class="statusbar">
          <span>{activeEntries().length} {activeEntries().length === 1 ? "item" : "items"}</span>
          <Show when={activeSelected().length}><span>{activeSelected().length} selected</span></Show>
          <Show when={panes().length > 1}><span>{panes().length} panes</span></Show>
          <Show when={clipboard()}>{(payload) => <span>{payload().mode === "copy" ? "Copied" : "Cut"} {payload().paths.length}</span>}</Show>
          <Show when={activePane()?.error}>{(message) => <span class="status-error" title={message()}>{message()}</span>}</Show>
        </footer>
      </section>

      <Show when={contextMenu()}>{(menu) => (
        <div class="context-menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }} onClick={(event) => event.stopPropagation()}>
          <button onClick={() => { focusPane(menu().paneId); setClipboard({ mode: "copy", paths: paneById(menu().paneId)?.selected ?? [] }); setContextMenu(null); }}><Icon name="copy" size={14} />Copy</button>
          <button onClick={() => { focusPane(menu().paneId); setClipboard({ mode: "move", paths: paneById(menu().paneId)?.selected ?? [] }); setContextMenu(null); }}>Cut</button>
          <button onClick={() => startRename(menu().paneId, menu().path)}>Rename <kbd>F2</kbd></button>
          <button onClick={() => { focusPane(menu().paneId); void duplicateSelection(); }}>Duplicate <kbd>⌘D</kbd></button>
          <div class="menu-separator" />
          <button class="danger" onClick={() => { focusPane(menu().paneId); void trashSelection(); }}><Icon name="trash" size={14} />Move to Trash</button>
        </div>
      )}</Show>
    </div>
  );
}

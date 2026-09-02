import { listen } from "@tauri-apps/api/event";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import Icon, { type IconName } from "./components/Icon";
import {
  clearDirCache,
  copyEntries,
  createFolder,
  duplicateEntries,
  getSpecialDirectories,
  hydrateDirectory,
  listDirectory,
  moveEntries,
  openEntry,
  renameEntry,
  setActiveListing,
  trashEntries,
  watchDirectory,
} from "./lib/fs";
import type { ClipboardState, DirectoryListing, ExplorerTab, FsEntry, SpecialDirectories } from "./types";

const WORKSPACES_KEY = "scout.workspaces.v1";
const LINKED_PANES_KEY = "scout.linked-panes.v1";
const VIEW_KEY = "scout.view.v2";

type ViewMode = "icons" | "list" | "columns" | "gallery";

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
  silent?: boolean;
}

interface SavedWorkspace {
  id: string;
  name: string;
  panePaths: string[];
  activePaneIndex: number;
  showHidden: boolean;
  linkedPanes: boolean;
  updatedAt: number;
}

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function readWorkspaces(): SavedWorkspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as SavedWorkspace[];
    return Array.isArray(value)
      ? value.filter((workspace) => !!workspace?.id && Array.isArray(workspace.panePaths) && workspace.panePaths.length > 0)
      : [];
  } catch {
    return [];
  }
}

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

function joinChildPath(base: string, childName: string) {
  const separator = base.includes("\\") ? "\\" : "/";
  return base.endsWith("/") || base.endsWith("\\") ? `${base}${childName}` : `${base}${separator}${childName}`;
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

function iconForEntry(entry: FsEntry): IconName {
  if (entry.kind === "directory") return "folder";
  const ext = (entry.extension ?? "").toLowerCase();
  if (["png","jpg","jpeg","webp","gif","svg","heic","avif"].includes(ext)) return "image";
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return "video";
  if (["mp3","wav","ogg","flac","aac"].includes(ext)) return "music";
  if (["pdf"].includes(ext)) return "document";
  if (["zip","rar","7z","tar","gz"].includes(ext)) return "hard-drive";
  return "file";
}

export default function App() {
  const [special, setSpecial] = createSignal<SpecialDirectories | null>(null);
  const [tabs, setTabs] = createSignal<ExplorerTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal("");
  const [panes, setPanes] = createSignal<PaneState[]>([]);
  const [activePaneId, setActivePaneId] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [linkedPanes, setLinkedPanes] = createSignal(localStorage.getItem(LINKED_PANES_KEY) === "1");
  const [workspaces, setWorkspaces] = createSignal<SavedWorkspace[]>(readWorkspaces());
  const [clipboard, setClipboard] = createSignal<ClipboardState | null>(null);
  const [renamePath, setRenamePath] = createSignal<string | null>(null);
  const [renamePaneId, setRenamePaneId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  const [viewMode, setViewMode] = createSignal<ViewMode>((() => {
    const value = localStorage.getItem(VIEW_KEY) ?? localStorage.getItem("scout.view.v1");
    if (value === "grid" || value === "icons") return "icons";
    if (value === "columns" || value === "gallery") return value;
    return "list";
  })());
  const [searchQuery, setSearchQuery] = createSignal("");
  const [toolbarMenuOpen, setToolbarMenuOpen] = createSignal(false);
  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [zoom, setZoom] = createSignal(1);
  const [sortBy, setSortBy] = createSignal<"name" | "modified" | "size" | "type">("name");
  const [sortDir, setSortDir] = createSignal<"asc" | "desc">("asc");
  let rubberBand: HTMLDivElement | null = null;
  let rbStart: { x: number; y: number } | null = null;
  let stopFilesystemListener: (() => void) | undefined;
  let refreshTimer: number | undefined;
  const paneLoadVersion = new Map<string, number>();

  const activeTab = createMemo(() => tabs().find((tab) => tab.id === activeTabId()) ?? null);
  const activePane = createMemo(() => panes().find((pane) => pane.id === activePaneId()) ?? null);
  const activeEntries = createMemo(() => activePane()?.listing?.entries ?? []);
  const filteredEntries = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    const entries = activeEntries();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  });
  const sortedEntries = createMemo(() => {
    const entries = [...filteredEntries()];
    const by = sortBy();
    const dir = sortDir() === "asc" ? 1 : -1;
    entries.sort((a, b) => {
      if (by === "name") return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
      if (by === "size") return ((a.size ?? -1) - (b.size ?? -1)) * dir;
      if (by === "type") {
        const aType = `${a.kind}:${a.extension ?? ""}:${a.name}`.toLowerCase();
        const bType = `${b.kind}:${b.extension ?? ""}:${b.name}`.toLowerCase();
        return aType.localeCompare(bType) * dir;
      }
      return ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) * dir;
    });
    // keep dirs first like Nautilus, then sort within
    return entries.sort((a, b) => {
      const ad = a.kind === "directory" ? 0 : 1;
      const bd = b.kind === "directory" ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return 0;
    });
  });
  const breadcrumbs = createMemo(() => {
    const p = activePane()?.path ?? "";
    if (!p) return [] as Array<{ name: string; path: string }>;
    const isAbs = p.startsWith("/");
    const parts = p.split("/").filter(Boolean);
    return parts.map((_, i) => ({
      name: parts[i] || "/",
      path: (isAbs ? "/" : "") + parts.slice(0, i + 1).join("/"),
    }));
  });
  const toggleSort = (by: "name" | "modified" | "size" | "type") => {
    if (sortBy() === by) setSortDir(sortDir() === "asc" ? "desc" : "asc");
    else { setSortBy(by); setSortDir("asc"); }
  };
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
    if (dirs.pictures) items.push({ label: "Pictures", path: dirs.pictures, icon: "image" });
    if (dirs.music) items.push({ label: "Music", path: dirs.music, icon: "music" });
    if (dirs.movies) items.push({ label: "Movies", path: dirs.movies, icon: "video" });
    return items;
  });

  const macLocations = createMemo<SidebarItem[]>(() => {
    const dirs = special();
    if (!dirs) return [];
    const items: SidebarItem[] = [];
    if (dirs.icloud) items.push({ label: "iCloud Drive", path: dirs.icloud, icon: "cloud" });
    items.push({ label: "Macintosh HD", path: "/", icon: "hard-drive" });
    for (const d of dirs.drives ?? []) {
      const name = d.split("/").pop() || d;
      if (name !== "Macintosh HD" && d !== "/") items.push({ label: name, path: d, icon: "hard-drives" });
    }
    if (dirs.applications) items.push({ label: "Applications", path: dirs.applications, icon: "hard-drive" });
    if (dirs.network) items.push({ label: "Network", path: dirs.network, icon: "globe" });
    if (dirs.trash) items.push({ label: "Trash", path: dirs.trash, icon: "trash" });
    return items;
  });

  function persistWorkspaces(next: SavedWorkspace[]) {
    setWorkspaces(next);
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(next));
  }

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

    // Files/Finder-style navigation: enumerate names/types quickly, paint immediately,
    // then hydrate expensive metadata off the UI path. A version token prevents a
    // slower old folder request from overwriting a newer navigation.
    const version = (paneLoadVersion.get(id) ?? 0) + 1;
    paneLoadVersion.set(id, version);
    const requestedHidden = showHidden();
    updatePane(id, (pane) => ({ ...pane, loading: true, error: options.silent ? pane.error : null }));

    try {
      const listing = await listDirectory(path, requestedHidden);
      if (paneLoadVersion.get(id) !== version) return null;

      const latest = paneById(id) ?? current;
      const pushHistory = options.pushHistory ?? true;
      let history = latest.history;
      let historyIndex = latest.historyIndex;

      if (options.resetHistory) {
        history = [listing.path];
        historyIndex = 0;
      } else if (options.historyIndex !== undefined) {
        historyIndex = options.historyIndex;
      } else if (pushHistory) {
        history = [...latest.history.slice(0, latest.historyIndex + 1), listing.path];
        historyIndex = history.length - 1;
      }

      const nextPane: PaneState = {
        ...latest,
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
        void watchDirectory(listing.path).catch((reason) => {
          if (paneLoadVersion.get(id) === version) {
            updatePane(id, (pane) => ({ ...pane, error: String(reason) }));
          }
        });
        if (options.syncTab !== false) syncTabToPane(nextPane);
      }

      void hydrateDirectory(listing.path, requestedHidden)
        .then((hydrated) => {
          if (paneLoadVersion.get(id) !== version) return;
          const pane = paneById(id);
          if (!pane || pane.path !== hydrated.path) return;
          updatePane(id, (candidate) => ({ ...candidate, listing: hydrated }));
          if (id === activePaneId()) setActiveListing(hydrated);
        })
        .catch(() => {
          // The fast listing is already usable. Metadata hydration is best-effort.
        });

      return nextPane;
    } catch (reason) {
      if (paneLoadVersion.get(id) === version) {
        updatePane(id, (pane) => ({ ...pane, loading: false, error: options.silent ? pane.error : String(reason) }));
      }
      return null;
    }
  }

  async function navigate(path: string) {
    const id = activePaneId();
    if (id) await loadPane(id, path);
  }

  async function navigateChild(paneId: string, entry: FsEntry) {
    if (!linkedPanes() || panes().length <= 1) {
      await loadPane(paneId, entry.path);
      return;
    }

    const snapshot = panes();
    await Promise.all(snapshot.map(async (pane) => {
      const target = pane.id === paneId ? entry.path : joinChildPath(pane.path, entry.name);
      await loadPane(pane.id, target, { silent: pane.id !== paneId, syncTab: pane.id === paneId });
    }));
    focusPane(paneId);
  }

  async function goUp() {
    const pane = activePane();
    if (!pane?.listing?.parentPath) return;
    if (!linkedPanes() || panes().length <= 1) {
      await loadPane(pane.id, pane.listing.parentPath);
      return;
    }

    const snapshot = panes();
    await Promise.all(snapshot.map(async (candidate) => {
      const parent = candidate.listing?.parentPath;
      if (!parent) return;
      await loadPane(candidate.id, parent, { silent: candidate.id !== pane.id, syncTab: candidate.id === pane.id });
    }));
    focusPane(pane.id);
  }

  async function reloadPane(id: string) {
    const pane = paneById(id);
    if (!pane) return;
    clearDirCache(pane.path);
    await loadPane(id, pane.path, { pushHistory: false });
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

    if (!linkedPanes() || panes().length <= 1) {
      const nextIndex = pane.historyIndex + delta;
      const path = pane.history[nextIndex];
      if (path) await loadPane(pane.id, path, { pushHistory: false, historyIndex: nextIndex });
      return;
    }

    const snapshot = panes();
    await Promise.all(snapshot.map(async (candidate) => {
      const nextIndex = candidate.historyIndex + delta;
      const path = candidate.history[nextIndex];
      if (!path) return;
      await loadPane(candidate.id, path, {
        pushHistory: false,
        historyIndex: nextIndex,
        silent: candidate.id !== pane.id,
        syncTab: candidate.id === pane.id,
      });
    }));
    focusPane(pane.id);
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
      const requestedHidden = showHidden();
      const listing = await listDirectory(path, requestedHidden);
      const pane = paneFromListing(listing);
      setPanes((current) => [...current, pane]);
      setActivePaneId(pane.id);
      setActiveListing(listing);
      syncTabToPane(pane);
      void hydrateDirectory(listing.path, requestedHidden).then((hydrated) => {
        updatePane(pane.id, (candidate) => candidate.path === hydrated.path ? { ...candidate, listing: hydrated } : candidate);
        if (activePaneId() === pane.id) setActiveListing(hydrated);
      }).catch(() => {});
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

  function toggleLinkedPanes() {
    const next = !linkedPanes();
    setLinkedPanes(next);
    localStorage.setItem(LINKED_PANES_KEY, next ? "1" : "0");
  }

  function setView(next: ViewMode) {
    setViewMode(next);
    localStorage.setItem(VIEW_KEY, next);
    setViewMenuOpen(false);
  }

  function cycleViewMode() {
    const order: ViewMode[] = ["icons", "list", "columns", "gallery"];
    const index = Math.max(0, order.indexOf(viewMode()));
    setView(order[(index + 1) % order.length]);
  }

  function viewIcon(): IconName {
    if (viewMode() === "icons") return "grid";
    if (viewMode() === "columns") return "columns";
    if (viewMode() === "gallery") return "image";
    return "rows";
  }

  function viewContainerClass() {
    if (viewMode() === "icons") return "file-grid";
    if (viewMode() === "columns") return "file-columns";
    if (viewMode() === "gallery") return "file-gallery";
    return "file-list";
  }

  function saveWorkspace() {
    const snapshot = panes();
    if (!snapshot.length) return;
    const activeIndex = Math.max(0, snapshot.findIndex((pane) => pane.id === activePaneId()));
    const workspace: SavedWorkspace = {
      id: makeId(),
      name: `Workspace ${workspaces().length + 1}`,
      panePaths: snapshot.map((pane) => pane.path),
      activePaneIndex: activeIndex,
      showHidden: showHidden(),
      linkedPanes: linkedPanes(),
      updatedAt: Date.now(),
    };
    persistWorkspaces([workspace, ...workspaces()].slice(0, 20));
  }

  function deleteWorkspace(id: string) {
    persistWorkspaces(workspaces().filter((workspace) => workspace.id !== id));
  }

  async function restoreWorkspace(workspace: SavedWorkspace) {
    const paths = workspace.panePaths.slice(0, 4);
    if (!paths.length) return;
    const listings = await Promise.all(paths.map(async (path) => {
      try {
        return await listDirectory(path, workspace.showHidden);
      } catch {
        return null;
      }
    }));
    const restored = listings.filter((listing): listing is DirectoryListing => !!listing).map(paneFromListing);
    if (!restored.length) return;

    const activeIndex = Math.min(Math.max(workspace.activePaneIndex, 0), restored.length - 1);
    const focused = restored[activeIndex];
    setShowHidden(workspace.showHidden);
    setLinkedPanes(workspace.linkedPanes);
    localStorage.setItem(LINKED_PANES_KEY, workspace.linkedPanes ? "1" : "0");
    setPanes(restored);
    setActivePaneId(focused.id);
    setActiveListing(focused.listing);
    syncTabToPane(focused);
    for (const pane of restored) {
      void hydrateDirectory(pane.path, workspace.showHidden).then((hydrated) => {
        updatePane(pane.id, (candidate) => candidate.path === hydrated.path ? { ...candidate, listing: hydrated } : candidate);
        if (activePaneId() === pane.id) setActiveListing(hydrated);
      }).catch(() => {});
    }
    await watchDirectory(focused.path);
  }

  function selectEntry(event: MouseEvent, paneId: string, entry: FsEntry, index: number) {
    if (isDragging()) return;
    // Preserve scroll - clicking was resetting to top
    const fileArea = document.querySelector<HTMLElement>(`.explorer-pane[data-pane-path="${paneById(paneId)?.path}"] .file-area`);
    const scrollTop = fileArea?.scrollTop ?? null;
    focusPane(paneId);
    const pane = paneById(paneId);
    if (!pane) return;
    const modifier = event.metaKey || event.ctrlKey;
    const shift = event.shiftKey;
    const anchor = pane.selectionAnchor;
    const entries = sortedEntries().length ? sortedEntries() : pane.listing?.entries ?? [];

    if (shift && modifier && anchor !== null) {
      // Nautilus: Ctrl+Shift+click = add range to existing
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      const range = entries.slice(from, to + 1).map((e) => e.path);
      const set = new Set(pane.selected);
      for (const p of range) set.add(p);
      updatePane(paneId, (c) => ({ ...c, selected: [...set], selectionAnchor: index }));
    } else if (shift && anchor !== null) {
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      updatePane(paneId, (current) => ({ ...current, selected: entries.slice(from, to + 1).map((item) => item.path) }));
    } else if (modifier) {
      updatePane(paneId, (current) => ({
        ...current,
        selected: current.selected.includes(entry.path)
          ? current.selected.filter((path) => path !== entry.path)
          : [...current.selected, entry.path],
        selectionAnchor: index,
      }));
    } else {
      updatePane(paneId, (current) => ({ ...current, selected: [entry.path], selectionAnchor: index }));
    }
    if (scrollTop !== null && fileArea) {
      requestAnimationFrame(() => {
        if (fileArea) fileArea.scrollTop = scrollTop;
      });
    }
  }

  function handleRubberBandDown(paneId: string, e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".pane-file-row, .file-header, button, input")) return;
    const area = e.currentTarget as HTMLElement;
    const rect = area.getBoundingClientRect();
    rbStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!rubberBand) {
      rubberBand = document.createElement("div");
      rubberBand.className = "rubber-band";
      area.appendChild(rubberBand);
    }
    const onMove = (ev: PointerEvent) => {
      if (!rbStart || !rubberBand) return;
      const cur = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const x = Math.min(rbStart.x, cur.x);
      const y = Math.min(rbStart.y, cur.y);
      const w = Math.abs(cur.x - rbStart.x);
      const h = Math.abs(cur.y - rbStart.y);
      rubberBand.style.left = `${x}px`;
      rubberBand.style.top = `${y}px`;
      rubberBand.style.width = `${w}px`;
      rubberBand.style.height = `${h}px`;
      // select rows intersecting
      const rows = [...area.querySelectorAll<HTMLElement>(".pane-file-row")];
      const selected: string[] = [];
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        const rel = { x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height };
        const intersect = !(rel.x + rel.w < x || rel.x > x + w || rel.y + rel.h < y || rel.y > y + h);
        if (intersect) {
          const p = row.dataset.entryPath;
          if (p) selected.push(p);
        }
      }
      updatePane(paneId, (c) => ({ ...c, selected }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      rubberBand?.remove();
      rubberBand = null;
      rbStart = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function activateEntry(paneId: string, entry: FsEntry) {
    focusPane(paneId);
    if (entry.kind === "directory") await navigateChild(paneId, entry);
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
    const entries = pane && pane.id === activePaneId() ? sortedEntries() : pane?.listing?.entries ?? [];
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

    if (modifier && key === "a") {
      event.preventDefault();
      const pane = activePane();
      const entries = pane && pane.id === activePaneId() ? sortedEntries() : pane?.listing?.entries ?? [];
      if (pane) updatePane(pane.id, (c) => ({ ...c, selected: entries.map((e) => e.path), selectionAnchor: 0 }));
    } else if (modifier && key === "c" && selected.length) {
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
    } else if (modifier && event.shiftKey && (key === "n" || event.key === "N")) {
      event.preventDefault();
      await makeFolder();
    } else if ((event.key === "h" || event.key === "H") && modifier) {
      event.preventDefault();
      await toggleHiddenFiles();
    } else if (modifier && event.shiftKey && event.key === ".") {
      event.preventDefault();
      await toggleHiddenFiles();
    } else if ((event.key === "=" || event.key === "+") && modifier) {
      event.preventDefault();
      setZoom((z) => Math.min(1.4, z + 0.1));
    } else if (event.key === "-" && modifier) {
      event.preventDefault();
      setZoom((z) => Math.max(0.85, z - 0.1));
    } else if (event.key === "0" && modifier) {
      event.preventDefault();
      setZoom(1);
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
    } else if (event.key === "F5") {
      event.preventDefault();
      await reloadActivePane();
    }
  }

  function closeContextMenu() {
    setContextMenu(null);
    setToolbarMenuOpen(false);
    setViewMenuOpen(false);
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
      void hydrateDirectory(first.path, showHidden()).then((hydrated) => {
        const active = activePaneId();
        if (!active) return;
        updatePane(active, (candidate) => candidate.path === hydrated.path ? { ...candidate, listing: hydrated } : candidate);
        if (paneById(active)?.path === hydrated.path) setActiveListing(hydrated);
      }).catch(() => {});
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
      <aside class="sidebar glass-sidebar">
        {/* Traffic lights drag region — like LazyLips: 40px strip, negative margins so top-left corner stays draggable */}
        <div data-tauri-drag-region="deep" class="sidebar-drag-region" />
        <div class="brand-row"><Icon name="scout" size={18} weight="fill" /><span>Scout</span></div>
        <div class="sidebar-section-label">Places</div>
        <nav class="sidebar-nav">
          <For each={sidebarItems()}>{(item) => (
            <button class="sidebar-item" classList={{ active: activePane()?.path === item.path }} onClick={() => navigate(item.path)} onMouseEnter={() => { void listDirectory(item.path, showHidden()).catch(()=>{}); }}>
              <Icon name={item.icon} size={15} /><span>{item.label}</span>
            </button>
          )}</For>
        </nav>

        <div class="sidebar-section-label" style="margin-top:14px">Locations</div>
        <nav class="sidebar-nav">
          <For each={macLocations()}>{(item) => (
            <button class="sidebar-item" classList={{ active: activePane()?.path === item.path }} onClick={() => navigate(item.path)} onMouseEnter={() => { void listDirectory(item.path, showHidden()).catch(()=>{}); }}>
              <Icon name={item.icon} size={14} /><span>{item.label}</span>
            </button>
          )}</For>
        </nav>

        <Show when={workspaces().length > 0}>
          <div class="sidebar-section-heading">
            <span class="sidebar-section-label">Workspaces</span>
            <button class="sidebar-section-action" onClick={saveWorkspace} aria-label="Save workspace" title="Save current workspace"><Icon name="plus" size={12} /></button>
          </div>
          <nav class="sidebar-nav workspace-list">
            <For each={workspaces()}>{(workspace) => (
              <div class="workspace-row">
                <button class="sidebar-item workspace-open" onClick={() => void restoreWorkspace(workspace)} title={workspace.panePaths.join("\n")}>
                  <Icon name="split" size={14} />
                  <span>{workspace.name}</span>
                  <span class="workspace-count">{workspace.panePaths.length}</span>
                </button>
                <button class="workspace-delete" onClick={() => deleteWorkspace(workspace.id)} aria-label={`Delete ${workspace.name}`}><Icon name="close" size={11} /></button>
              </div>
            )}</For>
          </nav>
        </Show>

        <div class="sidebar-spacer" />
      </aside>

      <section class="workspace">
        <header class="toolbar glass-toolbar">
          <div class="toolbar-group">
            <button class="icon-button" disabled={!canGoBack()} onClick={() => goHistory(-1)} aria-label="Back"><Icon name="arrow-left" /></button>
            <button class="icon-button" disabled={!canGoForward()} onClick={() => goHistory(1)} aria-label="Forward"><Icon name="arrow-right" /></button>
            <button class="icon-button" disabled={!activePane()?.listing?.parentPath} onClick={goUp} aria-label="Up"><Icon name="arrow-up" /></button>
          </div>
          <div class="path-display breadcrumbs" title={activePane()?.path ?? ""}>
            <Show when={breadcrumbs().length} fallback={"Loading…"}>
              <For each={breadcrumbs()}>{(crumb, i) => (
                <>
                  <button class="breadcrumb" onClick={() => navigate(crumb.path)}>{crumb.name || "/"}</button>
                  <Show when={i() < breadcrumbs().length - 1}><span class="breadcrumb-sep">›</span></Show>
                </>
              )}</For>
            </Show>
          </div>
          <div class="toolbar-group toolbar-actions">
            <div class="search-box">
              <Icon name="search" size={14} />
              <input placeholder="Search" value={searchQuery()} onInput={(e) => setSearchQuery(e.currentTarget.value)} />
              <Show when={searchQuery()}><button class="search-clear" onClick={() => setSearchQuery("")}><Icon name="close" size={12} /></button></Show>
            </div>
            <div class="toolbar-view-group">
              <button class="icon-button view-cycle" onClick={cycleViewMode} aria-label="Cycle view" title={`View: ${viewMode()}`}>
                <Icon name={viewIcon()} size={16} />
              </button>
              <div class="toolbar-divider" />
              <button
                class="icon-button toolbar-dropdown"
                onClick={(event) => {
                  event.stopPropagation();
                  setToolbarMenuOpen(false);
                  setViewMenuOpen(!viewMenuOpen());
                }}
                aria-label="Choose view"
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen()}
              >
                <Icon name="chevron-down" size={14} />
              </button>
              <Show when={viewMenuOpen()}>
                <div class="view-menu glass-surface" role="menu" onClick={(event) => event.stopPropagation()}>
                  <button classList={{ selected: viewMode() === "icons" }} onClick={() => setView("icons")} role="menuitemradio" aria-checked={viewMode() === "icons"}>
                    <span class="view-check">{viewMode() === "icons" ? "✓" : ""}</span><span>as Icons</span>
                  </button>
                  <button classList={{ selected: viewMode() === "list" }} onClick={() => setView("list")} role="menuitemradio" aria-checked={viewMode() === "list"}>
                    <span class="view-check">{viewMode() === "list" ? "✓" : ""}</span><span>as List</span>
                  </button>
                  <button classList={{ selected: viewMode() === "columns" }} onClick={() => setView("columns")} role="menuitemradio" aria-checked={viewMode() === "columns"}>
                    <span class="view-check">{viewMode() === "columns" ? "✓" : ""}</span><span>as Columns</span>
                  </button>
                  <button classList={{ selected: viewMode() === "gallery" }} onClick={() => setView("gallery")} role="menuitemradio" aria-checked={viewMode() === "gallery"}>
                    <span class="view-check">{viewMode() === "gallery" ? "✓" : ""}</span><span>as Gallery</span>
                  </button>
                </div>
              </Show>
            </div>
            <div class="toolbar-more">
              <button
                class="icon-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setViewMenuOpen(false);
                  setToolbarMenuOpen(!toolbarMenuOpen());
                }}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={toolbarMenuOpen()}
              ><Icon name="more" size={17} /></button>
              <Show when={toolbarMenuOpen()}>
                <div class="toolbar-dropdown-menu glass-surface" role="menu" onClick={(event) => event.stopPropagation()}>
                  <button onClick={() => { setToolbarMenuOpen(false); toggleLinkedPanes(); }}><Icon name="link" size={14} /> Linked panes <span class="menu-state">{linkedPanes() ? "✓" : ""}</span></button>
                  <button disabled={panes().length >= 4} onClick={() => { setToolbarMenuOpen(false); void addPane(); }}><Icon name="split" size={14} /> Add pane</button>
                  <button onClick={() => { setToolbarMenuOpen(false); void toggleHiddenFiles(); }}><Icon name={showHidden() ? "eye-slash" : "eye"} size={14} /> {showHidden() ? "Hide hidden files" : "Show hidden files"}</button>
                  <div class="menu-separator" />
                  <button onClick={() => { setSortBy("name"); setSortDir("asc"); }}><span class="menu-check-slot">{sortBy() === "name" ? "✓" : ""}</span> Sort by Name</button>
                  <button onClick={() => { setSortBy("modified"); setSortDir("desc"); }}><span class="menu-check-slot">{sortBy() === "modified" ? "✓" : ""}</span> Sort by Modified</button>
                  <button onClick={() => { setSortBy("size"); setSortDir("asc"); }}><span class="menu-check-slot">{sortBy() === "size" ? "✓" : ""}</span> Sort by Size</button>
                  <button onClick={() => { setSortBy("type"); setSortDir("asc"); }}><span class="menu-check-slot">{sortBy() === "type" ? "✓" : ""}</span> Sort by Type</button>
                  <button onClick={() => setSortDir(sortDir() === "asc" ? "desc" : "asc")}><span class="menu-check-slot">{sortDir() === "desc" ? "✓" : ""}</span> Reverse order</button>
                  <div class="menu-separator" />
                  <button onClick={() => { setToolbarMenuOpen(false); void makeFolder(); }}><Icon name="new-folder" size={14} /> New folder</button>
                </div>
              </Show>
            </div>
            <button class="icon-button primary" onClick={makeFolder} aria-label="New folder"><Icon name="new-folder" /></button>
          </div>
        </header>

        <div class="tab-strip piles">
          <For each={tabs()}>{(tab, idx) => (
            <button class="tab pile" classList={{ active: tab.id === activeTabId() }} onClick={() => switchTab(tab.id)} style={`z-index:${10 - idx()}; margin-left:${idx() > 0 ? "-8px" : "0"}`}>
              <Icon name="folder" size={13} weight={tab.id === activeTabId() ? "fill" : "regular"} /><span>{tab.title}</span>
              <Show when={tabs().length > 1}><span class="tab-close" role="button" onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}><Icon name="close" size={12} /></span></Show>
            </button>
          )}</For>
          <button class="new-tab-button" onClick={newTab} aria-label="New tab"><Icon name="plus" size={14} /></button>
        </div>

        <div class={`pane-grid panes-${panes().length} view-${viewMode()}`}>
          <For each={panes()}>{(pane) => (
            <section class="explorer-pane" classList={{ active: pane.id === activePaneId() }} data-pane-path={pane.path} onPointerDown={() => focusPane(pane.id)}>
              <div class="pane-chrome glass-pane-chrome">
                <span class="pane-path" title={pane.path}>{pane.path}</span>
                <button class="pane-close-button always-visible" onClick={(event) => { event.stopPropagation(); removePane(pane.id); }} aria-label="Close pane"><Icon name="close" size={12} /></button>
              </div>
              <main
                class="file-area"
                classList={{ loading: pane.loading, dragging: isDragging() }}
                onDragStart={() => setIsDragging(true)}
                onDragEnd={() => setIsDragging(false)}
                onPointerDown={() => setIsDragging(false)}
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    focusPane(pane.id);
                    updatePane(pane.id, (current) => ({ ...current, selected: [], selectionAnchor: null }));
                  }
                }}
              >
                <Show when={pane.loading}><div class="directory-loading" aria-label="Loading folder"><span /></div></Show>
                <Show when={viewMode() === "list"}>
                  <div class="file-header">
                    <div onClick={() => toggleSort("name")} style="cursor:pointer; user-select:none">Name {sortBy()==="name" ? (sortDir()==="asc" ? "∧" : "∨") : ""}</div>
                    <div onClick={() => toggleSort("modified")} style="cursor:pointer; user-select:none">Modified {sortBy()==="modified" ? (sortDir()==="asc" ? "∧" : "∨") : ""}</div>
                    <div class="size-cell" onClick={() => toggleSort("size")} style="cursor:pointer; user-select:none">Size {sortBy()==="size" ? (sortDir()==="asc" ? "∧" : "∨") : ""}</div>
                  </div>
                </Show>
                <div class={viewContainerClass()} style={zoom() !== 1 ? `zoom:${zoom()}` : ""} onPointerDown={(e) => handleRubberBandDown(pane.id, e as any)}>
                  <For each={(pane.id === activePaneId() ? sortedEntries() : pane.listing?.entries ?? []) as any}>{(entry, index) => (
                    <div
                      class="pane-file-row"
                      classList={{
                        "file-row": pane.id === activePaneId(),
                        selected: pane.selected.includes(entry.path),
                        cut: clipboard()?.mode === "move" && !!clipboard()?.paths.includes(entry.path),
                        grid: viewMode() === "icons",
                        columns: viewMode() === "columns",
                        gallery: viewMode() === "gallery",
                      }}
                      data-entry-index={index()}
                      data-entry-path={entry.path}
                      data-entry-name={entry.name}
                      data-entry-kind={entry.kind}
                      data-entry-extension={entry.extension ?? ""}
                      data-entry-modified={entry.modifiedMs ?? ""}
                      onClick={(event) => { event.stopPropagation(); const d = (event as any).detail; if (d === 2) return; selectEntry(event, pane.id, entry, index()); }}
                      onDblClick={(e) => { e.preventDefault(); (e as any).stopPropagation(); setIsDragging(false); void activateEntry(pane.id, entry); }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        focusPane(pane.id);
                        if (!pane.selected.includes(entry.path)) updatePane(pane.id, (current) => ({ ...current, selected: [entry.path], selectionAnchor: index() }));
                        setContextMenu({ x: event.clientX, y: event.clientY, path: entry.path, paneId: pane.id });
                      }}
                      draggable={true}
                      onDragStart={(e) => {
                        const d = (e as DragEvent & { detail?: number }).detail;
                        if (d === 2) { e.preventDefault(); return; }
                        setIsDragging(true);
                        if (e.dataTransfer) {
                          e.dataTransfer.setData("text/plain", entry.path);
                          e.dataTransfer.effectAllowed = "copyMove";
                        }
                      }}
                      onDragEnd={() => setTimeout(() => setIsDragging(false), 80)}
                    >
                      <div class="name-cell">
                        <span class="file-icon"><Icon name={iconForEntry(entry)} size={viewMode()==="icons" ? 42 : viewMode()==="gallery" ? 64 : 17} weight={entry.kind==="directory" ? "fill" : "regular"} /></span>
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
                      <Show when={viewMode()==="list"}>
                        <div class="muted-cell">{formatModified(entry.modifiedMs)}</div>
                        <div class="muted-cell size-cell">{entry.kind === "directory" ? "—" : formatBytes(entry.size)}</div>
                      </Show>
                    </div>
                  )}</For>
                </div>
                <Show when={!pane.loading && (pane.listing?.entries.length ?? 0) === 0}><div class="empty-state">This folder is empty.</div></Show>
                <Show when={!!searchQuery() && !filteredEntries().length}><div class="empty-state">No matches for “{searchQuery()}”.</div></Show>
              </main>
            </section>
          )}</For>
        </div>

        <footer class="statusbar glass-statusbar">
          <span>{filteredEntries().length} of {activeEntries().length} {activeEntries().length === 1 ? "item" : "items"}</span>
          <Show when={searchQuery()}><span>filtered</span></Show>
          <Show when={activeSelected().length}><span>{activeSelected().length} selected</span></Show>
          <Show when={panes().length > 1}><span>{panes().length} panes{linkedPanes() ? " · linked" : ""}</span></Show>
          <Show when={clipboard()}>{(payload) => <span>{payload().mode === "copy" ? "Copied" : "Cut"} {payload().paths.length}</span>}</Show>
          <Show when={activePane()?.error}>{(message) => <span class="status-error" title={message()}>{message()}</span>}</Show>
        </footer>
      </section>

      <Show when={contextMenu()}>{(menu) => (
        <div class="context-menu glass-surface" style={{ left: `${menu().x}px`, top: `${menu().y}px` }} onClick={(event) => event.stopPropagation()}>
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

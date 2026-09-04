import { listen } from "@tauri-apps/api/event";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import Icon, { type IconName } from "./components/Icon";
import ColumnBrowser from "./components/ColumnBrowser";
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
const BOOKMARKS_KEY = "scout.bookmarks.v1";
const SHOW_HIDDEN_KEY = "scout.show-hidden.v1";
const ZOOM_KEY = "scout.zoom.v1";
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 1.4;
const TAB_SESSION_KEY = "scout.session.tabs.v1";
const SESSION_LAYOUT_KEY = "scout.session.layout.v1";
const LAST_LOCATION_KEY = "scout.session.last-location.v1";
const TAB_SESSION_LIMIT = 24;
const TAB_HISTORY_LIMIT = 80;

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

interface SavedBookmark {
  id: string;
  label: string;
  path: string;
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
  preserveColumnRoot?: boolean;
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

interface SavedTab {
  title: string;
  path: string;
  history: string[];
  historyIndex: number;
}

interface SavedTabSession {
  tabs: SavedTab[];
  activeIndex: number;
  updatedAt: number;
}

interface SavedSessionLayout {
  panePaths: string[];
  activePaneIndex: number;
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

function readBookmarks(): SavedBookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as SavedBookmark[];
    return Array.isArray(value)
      ? value.filter((bookmark) => !!bookmark?.id && typeof bookmark.path === "string" && !!bookmark.path)
      : [];
  } catch {
    return [];
  }
}

function readZoom() {
  const value = Number.parseFloat(localStorage.getItem(ZOOM_KEY) ?? "");
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function sessionComparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
}

function normalizeSavedHistory(path: string, historyValue: unknown, indexValue: unknown) {
  const history = Array.isArray(historyValue)
    ? historyValue.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
    : [];
  if (!history.length) history.push(path);

  const numericIndex = Number(indexValue);
  let historyIndex = Number.isFinite(numericIndex) ? Math.trunc(numericIndex) : history.length - 1;
  historyIndex = Math.min(Math.max(historyIndex, 0), history.length - 1);

  const maxStart = Math.max(0, history.length - TAB_HISTORY_LIMIT);
  const preferredStart = Math.max(0, historyIndex - Math.floor(TAB_HISTORY_LIMIT / 2));
  const start = Math.min(preferredStart, maxStart);
  const boundedHistory = history.slice(start, start + TAB_HISTORY_LIMIT);
  historyIndex -= start;
  boundedHistory[historyIndex] = path;
  return { history: boundedHistory, historyIndex };
}

function sanitizeSavedTab(value: unknown): SavedTab | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedTab>;
  const path = typeof candidate.path === "string" ? candidate.path.trim() : "";
  if (!path) return null;
  const normalized = normalizeSavedHistory(path, candidate.history, candidate.historyIndex);
  return {
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : path,
    path,
    history: normalized.history,
    historyIndex: normalized.historyIndex,
  };
}

function readTabSession(): SavedTabSession | null {
  try {
    const raw = localStorage.getItem(TAB_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedTabSession>;
    const tabs = Array.isArray(value.tabs)
      ? value.tabs.map(sanitizeSavedTab).filter((tab): tab is SavedTab => !!tab).slice(0, TAB_SESSION_LIMIT)
      : [];
    if (!tabs.length) return null;
    const requested = Number(value.activeIndex);
    const activeIndex = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 0, 0), tabs.length - 1);
    return { tabs, activeIndex, updatedAt: Number(value.updatedAt) || 0 };
  } catch {
    return null;
  }
}

function readSavedSessionLayout(): SavedSessionLayout | null {
  try {
    const raw = localStorage.getItem(SESSION_LAYOUT_KEY);
    if (!raw) {
      const legacyPath = localStorage.getItem(LAST_LOCATION_KEY)?.trim();
      return legacyPath ? { panePaths: [legacyPath], activePaneIndex: 0, updatedAt: 0 } : null;
    }
    const value = JSON.parse(raw) as Partial<SavedSessionLayout>;
    const panePaths = Array.isArray(value.panePaths)
      ? value.panePaths.filter((path): path is string => typeof path === "string" && !!path.trim()).slice(0, 4)
      : [];
    if (!panePaths.length) return null;
    const requested = Number(value.activePaneIndex);
    const activePaneIndex = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 0, 0), panePaths.length - 1);
    return { panePaths, activePaneIndex, updatedAt: Number(value.updatedAt) || 0 };
  } catch {
    return null;
  }
}

function persistTabSessionSnapshot(tabList: ExplorerTab[], activeId: string) {
  if (!tabList.length || !activeId) return;
  const sourceActiveIndex = tabList.findIndex((tab) => tab.id === activeId);
  if (sourceActiveIndex < 0) return;

  const maxStart = Math.max(0, tabList.length - TAB_SESSION_LIMIT);
  const preferredStart = Math.max(0, sourceActiveIndex - Math.floor(TAB_SESSION_LIMIT / 2));
  const start = Math.min(preferredStart, maxStart);
  const bounded = tabList.slice(start, start + TAB_SESSION_LIMIT);
  const tabs = bounded.map((tab) => {
    const normalized = normalizeSavedHistory(tab.path, tab.history, tab.historyIndex);
    return {
      title: tab.title || tab.path,
      path: tab.path,
      history: normalized.history,
      historyIndex: normalized.historyIndex,
    } satisfies SavedTab;
  });

  try {
    localStorage.setItem(TAB_SESSION_KEY, JSON.stringify({
      tabs,
      activeIndex: sourceActiveIndex - start,
      updatedAt: Date.now(),
    } satisfies SavedTabSession));
  } catch {
    // Tab continuity is best-effort and must never block normal browsing.
  }
}

function persistOwnerSessionLayout(paneList: PaneState[], activeIndex: number) {
  const panePaths = paneList.slice(0, 4).map((pane) => pane.path).filter(Boolean);
  if (!panePaths.length) return;
  const boundedActiveIndex = Math.min(Math.max(activeIndex, 0), panePaths.length - 1);
  try {
    localStorage.setItem(SESSION_LAYOUT_KEY, JSON.stringify({
      panePaths,
      activePaneIndex: boundedActiveIndex,
      updatedAt: Date.now(),
    } satisfies SavedSessionLayout));
    localStorage.setItem(LAST_LOCATION_KEY, panePaths[boundedActiveIndex] ?? panePaths[0]);
  } catch {
    // The live App state remains authoritative if storage is unavailable.
  }
}

function nearestSourceIndex(entries: Array<{ sourceIndex: number }>, requested: number) {
  if (!entries.length) return 0;
  const exact = entries.findIndex((entry) => entry.sourceIndex === requested);
  if (exact >= 0) return exact;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  entries.forEach((entry, index) => {
    const distance = Math.abs(entry.sourceIndex - requested);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
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
  const [showHidden, setShowHidden] = createSignal(localStorage.getItem(SHOW_HIDDEN_KEY) === "1");
  const [linkedPanes, setLinkedPanes] = createSignal(localStorage.getItem(LINKED_PANES_KEY) === "1");
  const [workspaces, setWorkspaces] = createSignal<SavedWorkspace[]>(readWorkspaces());
  const [bookmarks, setBookmarks] = createSignal<SavedBookmark[]>(readBookmarks());
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
  const [startupError, setStartupError] = createSignal<string | null>(null);
  const [locationEditing, setLocationEditing] = createSignal(false);
  const [locationValue, setLocationValue] = createSignal("");
  const [toolbarMenuOpen, setToolbarMenuOpen] = createSignal(false);
  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);
  const [columnRoots, setColumnRoots] = createSignal<Record<string, string>>({});
  const [isDragging, setIsDragging] = createSignal(false);
  const [zoom, setZoom] = createSignal(readZoom());
  const [sortBy, setSortBy] = createSignal<"name" | "modified" | "size" | "type">("name");
  const [sortDir, setSortDir] = createSignal<"asc" | "desc">("asc");
  let rubberBand: HTMLDivElement | null = null;
  let rbStart: { x: number; y: number } | null = null;
  let stopFilesystemListener: (() => void) | undefined;
  let refreshTimer: number | undefined;
  let searchInput: HTMLInputElement | undefined;
  let locationInput: HTMLInputElement | undefined;
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
  function sortEntries(entries: FsEntry[]) {
    const next = [...entries];
    const by = sortBy();
    const dir = sortDir() === "asc" ? 1 : -1;
    next.sort((a, b) => {
      const aDirectory = a.kind === "directory";
      const bDirectory = b.kind === "directory";
      if (aDirectory !== bDirectory) return aDirectory ? -1 : 1;
      if (by === "name") return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * dir;
      if (by === "size") return ((a.size ?? -1) - (b.size ?? -1)) * dir;
      if (by === "type") {
        const aType = `${a.kind}:${a.extension ?? ""}:${a.name}`.toLowerCase();
        const bType = `${b.kind}:${b.extension ?? ""}:${b.name}`.toLowerCase();
        return aType.localeCompare(bType, undefined, { numeric: true, sensitivity: "base" }) * dir;
      }
      return ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) * dir;
    });
    return next;
  }
  const sortedEntries = createMemo(() => sortEntries(filteredEntries()));
  const breadcrumbs = createMemo(() => {
    const raw = activePane()?.path ?? "";
    if (!raw) return [] as Array<{ name: string; path: string }>;
    const normalized = raw.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const drive = /^[a-zA-Z]:/.exec(normalized)?.[0] ?? null;
    const unc = raw.startsWith("\\\\");
    const unixAbsolute = !drive && !unc && normalized.startsWith("/");

    return parts.map((name, index) => {
      let path: string;
      if (drive) {
        const rest = parts.slice(1, index + 1);
        path = rest.length ? `${drive}\\${rest.join("\\")}` : `${drive}\\`;
      } else if (unc) {
        path = `\\\\${parts.slice(0, index + 1).join("\\")}`;
      } else {
        path = `${unixAbsolute ? "/" : ""}${parts.slice(0, index + 1).join("/")}`;
      }
      return { name, path };
    });
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

  createEffect(() => {
  const currentTabs = tabs();
  const currentActiveId = activeTabId();
  if (!currentTabs.length || !currentActiveId || !currentTabs.some((tab) => tab.id === currentActiveId)) return;
  persistTabSessionSnapshot(currentTabs, currentActiveId);
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

    const normalizedHome = dirs.home.replace(/\\/g, "/");
    const windowsDrive = /^([a-zA-Z]:)\//.exec(normalizedHome)?.[1] ?? null;
    const rootPath = windowsDrive ? `${windowsDrive}\\` : "/";
    const rootLabel = windowsDrive ? windowsDrive : normalizedHome.startsWith("/Users/") ? "Macintosh HD" : "Computer";
    items.push({ label: rootLabel, path: rootPath, icon: "hard-drive" });

    for (const drivePath of dirs.drives ?? []) {
      if (comparablePath(drivePath) === comparablePath(rootPath)) continue;
      const name = drivePath.split(/[\\/]/).filter(Boolean).pop() || drivePath;
      items.push({ label: name, path: drivePath, icon: "hard-drives" });
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

  function persistBookmarks(next: SavedBookmark[]) {
    setBookmarks(next);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  }

  function bookmarkLabel(path: string) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? path;
  }

  function addBookmark(path = activePane()?.path) {
    if (!path || bookmarks().some((bookmark) => comparablePath(bookmark.path) === comparablePath(path))) return;
    const bookmark: SavedBookmark = { id: makeId(), path, label: bookmarkLabel(path) };
    persistBookmarks([...bookmarks(), bookmark].slice(-32));
  }

  function removeBookmark(id: string) {
    persistBookmarks(bookmarks().filter((bookmark) => bookmark.id !== id));
  }

  function startLocationEdit() {
    const path = activePane()?.path;
    if (!path) return;
    setLocationValue(path);
    setLocationEditing(true);
    queueMicrotask(() => {
      locationInput?.focus();
      locationInput?.select();
    });
  }

  function resolveLocationInput(value: string) {
    const trimmed = value.trim();
    const home = special()?.home;
    if (!home || !trimmed.startsWith("~")) return trimmed;
    if (trimmed === "~") return home;
    if (!trimmed.startsWith("~/") && !trimmed.startsWith("~\\")) return trimmed;
    const separator = home.includes("\\") ? "\\" : "/";
    const suffix = trimmed.slice(2).split(/[\\/]+/).filter(Boolean).join(separator);
    return suffix ? `${home.replace(/[\\/]$/, "")}${separator}${suffix}` : home;
  }

  async function commitLocationEdit() {
    const destination = resolveLocationInput(locationValue());
    setLocationEditing(false);
    if (!destination || comparablePath(destination) === comparablePath(activePane()?.path ?? "")) return;
    await navigate(destination);
  }

  function paneById(id: string) {
    return panes().find((pane) => pane.id === id) ?? null;
  }

  function comparablePath(path: string) {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
  }

  function pathWithin(root: string, candidate: string) {
    const a = comparablePath(root);
    const b = comparablePath(candidate);
    return a === b || b.startsWith(a === "/" ? "/" : `${a}/`);
  }

  function remapPathPrefix(value: string, source: string, destination: string) {
    if (!pathWithin(source, value)) return value;
    const sourceNormalized = comparablePath(source);
    const valueNormalized = comparablePath(value);
    if (sourceNormalized === valueNormalized) return destination;
    const suffix = value.replace(/\\/g, "/").slice(source.replace(/\\/g, "/").replace(/\/+$/, "").length);
    const separator = destination.includes("\\") ? "\\" : "/";
    return `${destination.replace(/[\\/]$/, "")}${suffix.replace(/\//g, separator)}`;
  }

  function parentDirectory(path: string) {
    const separator = path.includes("\\") ? "\\" : "/";
    const trimmed = path.replace(/[\\/]+$/, "");
    const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    if (index < 0) return path;
    if (index === 0) return separator;
    if (index === 2 && /^[a-zA-Z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}${separator}`;
    return trimmed.slice(0, index);
  }

  function columnRootFor(pane: PaneState) {
    return columnRoots()[pane.id] ?? pane.path;
  }

  function setColumnRoot(paneId: string, path: string) {
    setColumnRoots((current) => ({ ...current, [paneId]: path }));
  }

  function updatePane(id: string, mutator: (pane: PaneState) => PaneState) {
    setPanes((current) => current.map((pane) => (pane.id === id ? mutator(pane) : pane)));
  }

  function updateActiveTab(mutator: (tab: ExplorerTab) => ExplorerTab) {
    const id = activeTabId();
    setTabs((current) => current.map((tab) => (tab.id === id ? mutator(tab) : tab)));
  }

  function syncTabToPane(pane: PaneState) {
    updateActiveTab((tab) => ({
      ...tab,
      path: pane.path,
      title: pane.title,
      history: [...pane.history],
      historyIndex: pane.historyIndex,
    }));
  }

  function focusPane(id: string) {
    const pane = paneById(id);
    if (!pane) return;
    const alreadyActive = activePaneId() === id;
    setActivePaneId(id);
    setActiveListing(pane.listing);
    syncTabToPane(pane);
    if (alreadyActive) return;
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

      if (viewMode() === "columns") {
        const root = columnRoots()[id];
        if (!options.preserveColumnRoot || !root || !pathWithin(root, listing.path)) setColumnRoot(id, listing.path);
      }

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

  async function navigateColumnDirectory(paneId: string, entry: FsEntry) {
    const loaded = await loadPane(paneId, entry.path, { preserveColumnRoot: true });
    if (!loaded) return;
    updatePane(paneId, (current) => ({ ...current, selected: [entry.path], selectionAnchor: null }));
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
      await loadPane(pane.id, pane.listing.parentPath, { preserveColumnRoot: viewMode() === "columns" });
      return;
    }

    const snapshot = panes();
    await Promise.all(snapshot.map(async (candidate) => {
      const parent = candidate.listing?.parentPath;
      if (!parent) return;
      await loadPane(candidate.id, parent, { silent: candidate.id !== pane.id, syncTab: candidate.id === pane.id, preserveColumnRoot: viewMode() === "columns" });
    }));
    focusPane(pane.id);
  }

  async function reloadPane(id: string) {
    const pane = paneById(id);
    if (!pane) return;
    clearDirCache(pane.path);
    await loadPane(id, pane.path, { pushHistory: false, preserveColumnRoot: viewMode() === "columns" });
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
      if (path) await loadPane(pane.id, path, { pushHistory: false, historyIndex: nextIndex, preserveColumnRoot: viewMode() === "columns" });
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
        preserveColumnRoot: viewMode() === "columns",
      });
    }));
    focusPane(pane.id);
  }

  async function switchTab(id: string) {
    const tab = tabs().find((candidate) => candidate.id === id);
    const pane = activePane();
    if (!tab || !pane || id === activeTabId()) return;
    syncTabToPane(pane);
    setActiveTabId(id);
    setRenamePath(null);
    setRenamePaneId(null);
    const loaded = await loadPane(pane.id, tab.path, { pushHistory: false, resetHistory: true, syncTab: false });
    if (!loaded) return;
    const history = tab.history?.length ? [...tab.history] : [tab.path];
    const historyIndex = Math.min(Math.max(tab.historyIndex ?? history.length - 1, 0), history.length - 1);
    updatePane(pane.id, (current) => ({ ...current, history, historyIndex }));
  }

  async function newTab() {
    const pane = activePane();
    const path = pane?.path ?? special()?.home;
    if (!path) return;
    if (pane) syncTabToPane(pane);
    const id = makeId();
    setTabs((current) => [...current, { id, title: pane?.title ?? "Scout", path, history: [path], historyIndex: 0 }]);
    setActiveTabId(id);
    if (pane) updatePane(pane.id, (current) => ({ ...current, history: [path], historyIndex: 0, selected: [], selectionAnchor: null }));
  }

  async function openDirectoryInNewTab(entry: FsEntry) {
    if (entry.kind !== "directory") return;
    const pane = activePane();
    if (!pane) return;
    const previousTabId = activeTabId();
    syncTabToPane(pane);
    const id = makeId();
    setTabs((current) => [...current, { id, title: entry.name, path: entry.path, history: [entry.path], historyIndex: 0 }]);
    setActiveTabId(id);
    const loaded = await loadPane(pane.id, entry.path, { pushHistory: false, resetHistory: true, syncTab: false });
    if (!loaded) {
      setTabs((current) => current.filter((tab) => tab.id !== id));
      setActiveTabId(previousTabId);
      return;
    }
    setTabs((current) => current.map((tab) => tab.id === id ? {
      ...tab,
      title: loaded.title,
      path: loaded.path,
      history: [loaded.path],
      historyIndex: 0,
    } : tab));
  }

  async function closeTab(id: string) {
    const current = tabs();
    if (current.length <= 1) return;
    const index = current.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const remaining = current.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (id === activeTabId()) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActiveTabId(next.id);
      const pane = activePane();
      if (pane) {
        const loaded = await loadPane(pane.id, next.path, { pushHistory: false, resetHistory: true, syncTab: false });
        if (loaded) {
          const history = next.history?.length ? [...next.history] : [next.path];
          const historyIndex = Math.min(Math.max(next.historyIndex ?? history.length - 1, 0), history.length - 1);
          updatePane(pane.id, (candidate) => ({ ...candidate, history, historyIndex }));
        }
      }
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
      if (viewMode() === "columns") setColumnRoot(pane.id, listing.path);
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
    setColumnRoots((roots) => {
      const next = { ...roots };
      delete next[id];
      return next;
    });
    if (id === activePaneId()) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActivePaneId(next.id);
      setActiveListing(next.listing);
      syncTabToPane(next);
      void watchDirectory(next.path).catch((reason) => {
        updatePane(next.id, (current) => ({ ...current, error: String(reason) }));
      });
    }
  }

  function toggleLinkedPanes() {
    const next = !linkedPanes();
    setLinkedPanes(next);
    localStorage.setItem(LINKED_PANES_KEY, next ? "1" : "0");
  }

  function setView(next: ViewMode) {
    if (next === "columns") {
      setColumnRoots((current) => {
        const roots = { ...current };
        for (const pane of panes()) roots[pane.id] = pane.path;
        return roots;
      });
    }
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
    localStorage.setItem(SHOW_HIDDEN_KEY, workspace.showHidden ? "1" : "0");
    setLinkedPanes(workspace.linkedPanes);
    localStorage.setItem(LINKED_PANES_KEY, workspace.linkedPanes ? "1" : "0");
    setPanes(restored);
    if (viewMode() === "columns") setColumnRoots(Object.fromEntries(restored.map((pane) => [pane.id, pane.path])));
    setActivePaneId(focused.id);
    setActiveListing(focused.listing);
    syncTabToPane(focused);
    for (const pane of restored) {
      void hydrateDirectory(pane.path, workspace.showHidden).then((hydrated) => {
        updatePane(pane.id, (candidate) => candidate.path === hydrated.path ? { ...candidate, listing: hydrated } : candidate);
        if (activePaneId() === pane.id) setActiveListing(hydrated);
      }).catch(() => {});
    }
    await watchDirectory(focused.path).catch((reason) => {
      updatePane(focused.id, (current) => ({ ...current, error: String(reason) }));
    });
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
    const fallbackName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    if (!entry && !fallbackName) return;
    focusPane(paneId);
    setRenamePaneId(paneId);
    setRenamePath(path);
    setRenameValue(entry?.name ?? fallbackName);
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
    const before = paneById(paneId);
    const rootBefore = columnRoots()[paneId];
    try {
      const renamed = await renameEntry(path, nextName);
      setRenamePath(null);
      setRenamePaneId(null);
      if (!before) return;
      const nextPanePath = remapPathPrefix(before.path, path, renamed.path);
      if (rootBefore) setColumnRoot(paneId, remapPathPrefix(rootBefore, path, renamed.path));
      updatePane(paneId, (current) => ({
        ...current,
        history: current.history.map((item) => remapPathPrefix(item, path, renamed.path)),
        selected: [renamed.path],
      }));
      if (nextPanePath !== before.path) {
        await loadPane(paneId, nextPanePath, { pushHistory: false, preserveColumnRoot: viewMode() === "columns" });
        updatePane(paneId, (current) => ({ ...current, selected: [renamed.path] }));
      } else {
        await reloadPane(paneId);
        updatePane(paneId, (current) => ({ ...current, selected: [renamed.path] }));
      }
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
    const removedAncestor = pane.selected.find((path) => pathWithin(path, pane.path));
    const fallback = removedAncestor ? parentDirectory(removedAncestor) : null;
    try {
      await trashEntries(pane.selected);
      setContextMenu(null);
      if (fallback) await loadPane(pane.id, fallback);
      else await reloadPane(pane.id);
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
    const next = !showHidden();
    setShowHidden(next);
    localStorage.setItem(SHOW_HIDDEN_KEY, next ? "1" : "0");
    await Promise.all(panes().map((pane) => reloadPane(pane.id)));
  }

  function persistZoom(next: number) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
    setZoom(clamped);
    localStorage.setItem(ZOOM_KEY, String(clamped));
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

  function moveSpatialSelection(direction: "left" | "right" | "up" | "down") {
    const pane = activePane();
    if (!pane) return;
    const rows = [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row")]
      .filter((row) => row.offsetParent !== null && !!row.dataset.entryPath);
    if (!rows.length) return;

    const currentPath = pane.selected[0];
    const current = rows.find((row) => row.dataset.entryPath === currentPath) ?? null;
    if (!current) {
      const first = rows[0];
      const path = first.dataset.entryPath;
      if (!path) return;
      updatePane(pane.id, (candidate) => ({ ...candidate, selected: [path], selectionAnchor: Number(first.dataset.entryIndex ?? 0) }));
      first.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }

    const source = current.getBoundingClientRect();
    const sx = source.left + source.width / 2;
    const sy = source.top + source.height / 2;
    let best: { row: HTMLElement; score: number } | null = null;
    for (const row of rows) {
      if (row === current) continue;
      const rect = row.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - sx;
      const dy = y - sy;
      const valid = direction === "left" ? dx < -2 : direction === "right" ? dx > 2 : direction === "up" ? dy < -2 : dy > 2;
      if (!valid) continue;
      const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
      const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 2.2;
      if (!best || score < best.score) best = { row, score };
    }
    if (!best) return;
    const path = best.row.dataset.entryPath;
    if (!path) return;
    const index = Number(best.row.dataset.entryIndex ?? 0);
    updatePane(pane.id, (candidate) => ({ ...candidate, selected: [path], selectionAnchor: Number.isFinite(index) ? index : null }));
    best.row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  async function handleKeyDown(event: KeyboardEvent) {
    if (renamePath()) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    // Location entry is a global file-manager command, even when Search is focused.
    if (modifier && key === "l") {
      event.preventDefault();
      startLocationEdit();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const selected = activeSelected();

    if (modifier && key === "f") {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (modifier && !event.shiftKey && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      const views: Record<string, ViewMode> = { "1": "icons", "2": "list", "3": "columns", "4": "gallery" };
      setView(views[event.key]);
    } else if (modifier && event.key === "[") {
      event.preventDefault();
      await goHistory(-1);
    } else if (modifier && event.key === "]") {
      event.preventDefault();
      await goHistory(1);
    } else if (modifier && event.key === "ArrowUp") {
      event.preventDefault();
      await goUp();
    } else if (modifier && event.key === "ArrowDown" && selected[0]) {
      event.preventDefault();
      const entry = activeEntries().find((candidate) => candidate.path === selected[0]);
      const pane = activePane();
      if (entry && pane) await activateEntry(pane.id, entry);
    } else if (modifier && key === "a") {
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
      persistZoom(zoom() + 0.1);
    } else if (event.key === "-" && modifier) {
      event.preventDefault();
      persistZoom(zoom() - 0.1);
    } else if (event.key === "0" && modifier) {
      event.preventDefault();
      persistZoom(1);
    } else if (event.key === "F2" && selected[0]) {
      event.preventDefault();
      startRename(activePaneId(), selected[0]);
    } else if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) {
      event.preventDefault();
      await trashSelection();
    } else if (event.key === "ArrowLeft" && (viewMode() === "icons" || viewMode() === "gallery")) {
      event.preventDefault();
      moveSpatialSelection("left");
    } else if (event.key === "ArrowRight" && (viewMode() === "icons" || viewMode() === "gallery")) {
      event.preventDefault();
      moveSpatialSelection("right");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (viewMode() === "icons" || viewMode() === "gallery") moveSpatialSelection("down");
      else moveKeyboardSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (viewMode() === "icons" || viewMode() === "gallery") moveSpatialSelection("up");
      else moveKeyboardSelection(-1);
    } else if (event.key === "Escape") {
      closeContextMenu();
      const pane = activePane();
      if (pane?.selected.length) updatePane(pane.id, (current) => ({ ...current, selected: [], selectionAnchor: null }));
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

  function handleTabsReordered() {
  const ids = [...document.querySelectorAll<HTMLElement>(".tab-strip > .tab[data-tab-id]")]
    .map((tab) => tab.dataset.tabId ?? "")
    .filter(Boolean);
  const current = tabs();
  if (ids.length !== current.length) return;
  const byId = new Map(current.map((tab) => [tab.id, tab]));
  const reordered = ids.map((id) => byId.get(id)).filter((tab): tab is ExplorerTab => !!tab);
  if (reordered.length !== current.length) return;
  if (reordered.every((tab, index) => tab.id === current[index]?.id)) return;
  setTabs(reordered);
}

function handleTabSessionPageHide() {
  persistTabSessionSnapshot(tabs(), activeTabId());
}

  async function initializeApp() {
  setStartupError(null);
  try {
    const dirs = await getSpecialDirectories();
    setSpecial(dirs);
    const requestedHidden = showHidden();
    const savedTabs = readTabSession();
    const savedLayout = readSavedSessionLayout();
    const listingCache = new Map<string, Promise<DirectoryListing | null>>();

    const listingFor = (path: string) => {
      const key = sessionComparablePath(path);
      const existing = listingCache.get(key);
      if (existing) return existing;
      const pending = listDirectory(path, requestedHidden).catch(() => null);
      listingCache.set(key, pending);
      return pending;
    };

    const resolvedTabs = await Promise.all((savedTabs?.tabs ?? []).map(async (saved, sourceIndex) => {
      const candidates: Array<{ path: string; historyIndex: number }> = [];
      const seen = new Set<string>();
      const addCandidate = (path: string | undefined, historyIndex: number) => {
        const trimmed = path?.trim();
        if (!trimmed) return;
        const key = sessionComparablePath(trimmed);
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ path: trimmed, historyIndex });
      };

      addCandidate(saved.path, saved.historyIndex);
      const recoveryRadius = Math.min(12, saved.history.length);
      for (let distance = 0; distance <= recoveryRadius; distance += 1) {
        addCandidate(saved.history[saved.historyIndex - distance], saved.historyIndex - distance);
        addCandidate(saved.history[saved.historyIndex + distance], saved.historyIndex + distance);
      }

      for (const candidate of candidates) {
        const listing = await listingFor(candidate.path);
        if (!listing) continue;
        const normalized = normalizeSavedHistory(listing.path, saved.history, candidate.historyIndex);
        return {
          sourceIndex,
          listing,
          tab: {
            id: makeId(),
            title: listing.displayName,
            path: listing.path,
            history: normalized.history,
            historyIndex: normalized.historyIndex,
          } satisfies ExplorerTab,
        };
      }
      return null;
    }));
    const validTabs = resolvedTabs.filter((entry): entry is NonNullable<typeof entry> => !!entry);
    let activeTabIndex = validTabs.length
      ? nearestSourceIndex(validTabs, savedTabs?.activeIndex ?? 0)
      : 0;

    const resolvedPanes = await Promise.all((savedLayout?.panePaths ?? []).slice(0, 4).map(async (path, sourceIndex) => {
      const listing = await listingFor(path);
      return listing ? { sourceIndex, listing } : null;
    }));
    const validPanes = resolvedPanes.filter((entry): entry is NonNullable<typeof entry> => !!entry);
    let activePaneIndex = validPanes.length
      ? nearestSourceIndex(validPanes, savedLayout?.activePaneIndex ?? 0)
      : 0;

    if (!validPanes.length && validTabs.length) {
      validPanes.push({ sourceIndex: 0, listing: validTabs[activeTabIndex].listing });
      activePaneIndex = 0;
    }

    if (!validPanes.length) {
      const home = await listingFor(dirs.home);
      if (!home) throw new Error(`Could not open home folder: ${dirs.home}`);
      validPanes.push({ sourceIndex: 0, listing: home });
      activePaneIndex = 0;
    }

    const focusedListing = validPanes[activePaneIndex].listing;
    const restoredTabs = validTabs.map((entry) => entry.tab);
    if (!restoredTabs.length) {
      const id = makeId();
      restoredTabs.push({
        id,
        title: focusedListing.displayName,
        path: focusedListing.path,
        history: [focusedListing.path],
        historyIndex: 0,
      });
      activeTabIndex = 0;
    }

    let restoredActiveTab = restoredTabs[activeTabIndex];
    if (sessionComparablePath(restoredActiveTab.path) !== sessionComparablePath(focusedListing.path)) {
      const normalized = normalizeSavedHistory(
        focusedListing.path,
        restoredActiveTab.history,
        restoredActiveTab.historyIndex,
      );
      restoredActiveTab = {
        ...restoredActiveTab,
        title: focusedListing.displayName,
        path: focusedListing.path,
        history: normalized.history,
        historyIndex: normalized.historyIndex,
      };
      restoredTabs[activeTabIndex] = restoredActiveTab;
    }

    const restoredPanes = validPanes.map(({ listing }) => paneFromListing(listing));
    const focusedPane = restoredPanes[activePaneIndex];
    focusedPane.history = [...restoredActiveTab.history];
    focusedPane.historyIndex = restoredActiveTab.historyIndex;

    // Write the owner-resolved layout before publishing DOM state so the
    // legacy continuity observer sees the same graph and does not replay it.
    persistOwnerSessionLayout(restoredPanes, activePaneIndex);
    persistTabSessionSnapshot(restoredTabs, restoredActiveTab.id);

    setPanes(restoredPanes);
    setActivePaneId(focusedPane.id);
    setTabs(restoredTabs);
    setActiveTabId(restoredActiveTab.id);
    if (viewMode() === "columns") {
      setColumnRoots(Object.fromEntries(restoredPanes.map((pane) => [pane.id, pane.path])));
    }
    setActiveListing(focusedPane.listing);

    for (const pane of restoredPanes) {
      void hydrateDirectory(pane.path, requestedHidden).then((hydrated) => {
        updatePane(pane.id, (candidate) => candidate.path === hydrated.path ? { ...candidate, listing: hydrated } : candidate);
        if (activePaneId() === pane.id) setActiveListing(hydrated);
      }).catch(() => {});
    }

    void watchDirectory(focusedPane.path).catch((reason) => {
      updatePane(focusedPane.id, (current) => ({ ...current, error: String(reason) }));
    });
  } catch (reason) {
    setStartupError(String(reason));
  }
}

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scout:navigate", handleScoutNavigate);
    window.addEventListener("scout:tabs-reordered", handleTabsReordered);
    window.addEventListener("pagehide", handleTabSessionPageHide);
    void listen("scout-fs-change", scheduleFilesystemRefresh)
      .then((cleanup) => { stopFilesystemListener = cleanup; })
      .catch(() => {
        // Browsing remains usable even if live refresh registration is unavailable.
      });
    void initializeApp();
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("click", closeContextMenu);
    window.removeEventListener("scout:navigate", handleScoutNavigate);
    window.removeEventListener("scout:tabs-reordered", handleTabsReordered);
    window.removeEventListener("pagehide", handleTabSessionPageHide);
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

        <div class="sidebar-section-heading">
          <span class="sidebar-section-label">Bookmarks</span>
          <button
            class="sidebar-section-action"
            disabled={!activePane() || bookmarks().some((bookmark) => comparablePath(bookmark.path) === comparablePath(activePane()?.path ?? ""))}
            onClick={() => addBookmark()}
            aria-label="Bookmark current folder"
            title="Bookmark current folder"
          ><Icon name="plus" size={12} /></button>
        </div>
        <Show when={bookmarks().length > 0} fallback={<div class="workspace-empty">Pin folders you use often</div>}>
          <nav class="sidebar-nav workspace-list bookmark-list">
            <For each={bookmarks()}>{(bookmark) => (
              <div class="workspace-row bookmark-row">
                <button class="sidebar-item workspace-open" classList={{ active: comparablePath(activePane()?.path ?? "") === comparablePath(bookmark.path) }} onClick={() => navigate(bookmark.path)} onMouseEnter={() => { void listDirectory(bookmark.path, showHidden()).catch(()=>{}); }} title={bookmark.path}>
                  <Icon name="folder" size={14} /><span>{bookmark.label}</span>
                </button>
                <button class="workspace-delete" onClick={() => removeBookmark(bookmark.id)} aria-label={`Remove ${bookmark.label} bookmark`}><Icon name="close" size={11} /></button>
              </div>
            )}</For>
          </nav>
        </Show>

        <div class="sidebar-section-label" style="margin-top:14px">Locations</div>
        <nav class="sidebar-nav">
          <For each={macLocations()}>{(item) => (
            <button class="sidebar-item" classList={{ active: activePane()?.path === item.path }} onClick={() => navigate(item.path)} onMouseEnter={() => { void listDirectory(item.path, showHidden()).catch(()=>{}); }}>
              <Icon name={item.icon} size={14} /><span>{item.label}</span>
            </button>
          )}</For>
        </nav>

        <div class="sidebar-section-heading">
          <span class="sidebar-section-label">Workspaces</span>
          <button class="sidebar-section-action" onClick={saveWorkspace} aria-label="Save workspace" title="Save current workspace"><Icon name="plus" size={12} /></button>
        </div>
        <Show when={workspaces().length > 0} fallback={<div class="workspace-empty">Save the current pane layout</div>}>
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
            <Show when={locationEditing()} fallback={
              <Show when={breadcrumbs().length} fallback={"Loading…"}>
                <For each={breadcrumbs()}>{(crumb, i) => (
                  <>
                    <button class="breadcrumb" onClick={() => navigate(crumb.path)}>{crumb.name || "/"}</button>
                    <Show when={i() < breadcrumbs().length - 1}><span class="breadcrumb-sep">›</span></Show>
                  </>
                )}</For>
              </Show>
            }>
              <input
                ref={(node) => { locationInput = node; }}
                class="location-input"
                value={locationValue()}
                onInput={(event) => setLocationValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") { event.preventDefault(); void commitLocationEdit(); }
                  if (event.key === "Escape") { event.preventDefault(); setLocationEditing(false); }
                }}
                onBlur={() => setLocationEditing(false)}
                aria-label="Location"
                spellcheck={false}
              />
            </Show>
          </div>
          <div class="toolbar-group toolbar-actions">
            <div class="search-box">
              <Icon name="search" size={14} />
              <input ref={(node) => { searchInput = node; }} placeholder="Search" value={searchQuery()} onInput={(e) => setSearchQuery(e.currentTarget.value)} aria-label="Filter current folder" />
              <Show when={searchQuery()}><button class="search-clear" onClick={() => setSearchQuery("")} aria-label="Clear folder filter"><Icon name="close" size={12} /></button></Show>
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
            <button data-tab-id={tab.id} class="tab pile" classList={{ active: tab.id === activeTabId() }} onClick={() => switchTab(tab.id)} style={`z-index:${10 - idx()}; margin-left:${idx() > 0 ? "-8px" : "0"}`}>
              <Icon name="folder" size={13} weight={tab.id === activeTabId() ? "fill" : "regular"} /><span>{tab.title}</span>
              <Show when={tabs().length > 1}><span class="tab-close" role="button" onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}><Icon name="close" size={12} /></span></Show>
            </button>
          )}</For>
          <button class="new-tab-button" onClick={newTab} aria-label="New tab"><Icon name="plus" size={14} /></button>
        </div>

        <div class={`pane-grid panes-${Math.max(1, panes().length)} view-${viewMode()}`}>
          <Show when={panes().length === 0}>
            <div class="startup-state">
              <Show when={startupError()} fallback={<><span class="startup-spinner" /><strong>Opening your files…</strong></>}>
                {(message) => <>
                  <strong>Scout could not open your home folder.</strong>
                  <span class="startup-message">{message()}</span>
                  <button class="startup-retry" onClick={() => void initializeApp()}>Retry</button>
                </>}
              </Show>
            </div>
          </Show>
          <For each={panes()}>{(pane) => (
            <section class="explorer-pane" classList={{ active: pane.id === activePaneId() }} data-pane-path={pane.path} onPointerDown={() => focusPane(pane.id)}>
              <div class="pane-chrome glass-pane-chrome">
                <span class="pane-path" title={pane.path}>{pane.path}</span>
                <button class="pane-close-button always-visible" onClick={(event) => { event.stopPropagation(); removePane(pane.id); }} aria-label="Close pane"><Icon name="close" size={12} /></button>
              </div>
              <Show when={viewMode() === "columns"} fallback={<>
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
                  <For each={(pane.id === activePaneId() ? sortedEntries() : sortEntries(pane.listing?.entries ?? [])) as any}>{(entry, index) => (
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
                      onAuxClick={(event) => {
                        if (event.button !== 1 || entry.kind !== "directory") return;
                        event.preventDefault();
                        event.stopPropagation();
                        focusPane(pane.id);
                        void openDirectoryInNewTab(entry);
                      }}
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
              </>}>
                <main class="file-area column-file-area" classList={{ loading: pane.loading }}>
                  <Show when={pane.loading}><div class="directory-loading" aria-label="Loading folder"><span /></div></Show>
                  <ColumnBrowser
                    paneId={pane.id}
                    rootPath={columnRootFor(pane)}
                    path={pane.path}
                    listing={pane.listing}
                    showHidden={showHidden()}
                    selected={pane.selected}
                    active={pane.id === activePaneId()}
                    sortBy={sortBy()}
                    sortDir={sortDir()}
                    query={searchQuery()}
                    renamePath={renamePaneId() === pane.id ? renamePath() : null}
                    renameValue={renameValue()}
                    onRenameInput={setRenameValue}
                    onCommitRename={() => void commitRename()}
                    onCancelRename={() => { setRenamePath(null); setRenamePaneId(null); }}
                    onFocus={() => focusPane(pane.id)}
                    onNavigateDirectory={(entry) => navigateColumnDirectory(pane.id, entry)}
                    onOpenDirectoryInNewTab={(entry) => openDirectoryInNewTab(entry)}
                    onSelection={(paths, anchor) => updatePane(pane.id, (current) => ({ ...current, selected: paths, selectionAnchor: anchor }))}
                    onOpenFile={(entry) => openEntry(entry.path)}
                    onContextMenu={(event, entry, index) => {
                      focusPane(pane.id);
                      if (!pane.selected.includes(entry.path)) updatePane(pane.id, (current) => ({ ...current, selected: [entry.path], selectionAnchor: index }));
                      setContextMenu({ x: event.clientX, y: event.clientY, path: entry.path, paneId: pane.id });
                    }}
                  />
                </main>
              </Show>
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
          <Show when={paneById(menu().paneId)?.listing?.entries.find((entry) => entry.path === menu().path)}>{(entry) => (
            <Show when={entry().kind === "directory"}>
              <button onClick={() => { focusPane(menu().paneId); setContextMenu(null); void openDirectoryInNewTab(entry()); }}><Icon name="folder" size={14} />Open in New Tab</button>
              <button
                disabled={bookmarks().some((bookmark) => comparablePath(bookmark.path) === comparablePath(entry().path))}
                onClick={() => { addBookmark(entry().path); setContextMenu(null); }}
              ><Icon name="plus" size={14} />Bookmark Folder</button>
              <div class="menu-separator" />
            </Show>
          )}</Show>
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

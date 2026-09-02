from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# App.tsx — navigation correctness, cross-platform UX, keyboard ergonomics
# ---------------------------------------------------------------------------
app_path = Path("src/App.tsx")
app = app_path.read_text()

old_breadcrumbs = '''  const breadcrumbs = createMemo(() => {
    const p = activePane()?.path ?? "";
    if (!p) return [] as Array<{ name: string; path: string }>;
    const isAbs = p.startsWith("/");
    const parts = p.split("/").filter(Boolean);
    return parts.map((_, i) => ({
      name: parts[i] || "/",
      path: (isAbs ? "/" : "") + parts.slice(0, i + 1).join("/"),
    }));
  });'''
new_breadcrumbs = '''  const breadcrumbs = createMemo(() => {
    const raw = activePane()?.path ?? "";
    if (!raw) return [] as Array<{ name: string; path: string }>;
    const normalized = raw.replace(/\\\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const drive = /^[a-zA-Z]:/.exec(normalized)?.[0] ?? null;
    const unc = raw.startsWith("\\\\\\\\");
    const unixAbsolute = !drive && !unc && normalized.startsWith("/");

    return parts.map((name, index) => {
      let path: string;
      if (drive) {
        const rest = parts.slice(1, index + 1);
        path = rest.length ? `${drive}\\\\${rest.join("\\\\")}` : `${drive}\\\\`;
      } else if (unc) {
        path = `\\\\\\\\${parts.slice(0, index + 1).join("\\\\")}`;
      } else {
        path = `${unixAbsolute ? "/" : ""}${parts.slice(0, index + 1).join("/")}`;
      }
      return { name, path };
    });
  });'''
app = replace_once(app, old_breadcrumbs, new_breadcrumbs, "cross-platform breadcrumbs")

old_locations = '''  const macLocations = createMemo<SidebarItem[]>(() => {
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
  });'''
new_locations = '''  const macLocations = createMemo<SidebarItem[]>(() => {
    const dirs = special();
    if (!dirs) return [];
    const items: SidebarItem[] = [];
    if (dirs.icloud) items.push({ label: "iCloud Drive", path: dirs.icloud, icon: "cloud" });

    const normalizedHome = dirs.home.replace(/\\\\/g, "/");
    const windowsDrive = /^([a-zA-Z]:)\\//.exec(normalizedHome)?.[1] ?? null;
    const rootPath = windowsDrive ? `${windowsDrive}\\\\` : "/";
    const rootLabel = windowsDrive ? windowsDrive : normalizedHome.startsWith("/Users/") ? "Macintosh HD" : "Computer";
    items.push({ label: rootLabel, path: rootPath, icon: "hard-drive" });

    for (const drivePath of dirs.drives ?? []) {
      if (comparablePath(drivePath) === comparablePath(rootPath)) continue;
      const name = drivePath.split(/[\\\\/]/).filter(Boolean).pop() || drivePath;
      items.push({ label: name, path: drivePath, icon: "hard-drives" });
    }
    if (dirs.applications) items.push({ label: "Applications", path: dirs.applications, icon: "hard-drive" });
    if (dirs.network) items.push({ label: "Network", path: dirs.network, icon: "globe" });
    if (dirs.trash) items.push({ label: "Trash", path: dirs.trash, icon: "trash" });
    return items;
  });'''
app = replace_once(app, old_locations, new_locations, "cross-platform locations")

old_sync = '''  function syncTabToPane(pane: PaneState) {
    updateActiveTab((tab) => ({ ...tab, path: pane.path, title: pane.title }));
  }'''
new_sync = '''  function syncTabToPane(pane: PaneState) {
    updateActiveTab((tab) => ({
      ...tab,
      path: pane.path,
      title: pane.title,
      history: [...pane.history],
      historyIndex: pane.historyIndex,
    }));
  }'''
app = replace_once(app, old_sync, new_sync, "tab history sync")

old_focus = '''  function focusPane(id: string) {
    const pane = paneById(id);
    if (!pane) return;
    setActivePaneId(id);
    setActiveListing(pane.listing);
    syncTabToPane(pane);
    void watchDirectory(pane.path).catch((reason) => {
      updatePane(id, (current) => ({ ...current, error: String(reason) }));
    });
  }'''
new_focus = '''  function focusPane(id: string) {
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
  }'''
app = replace_once(app, old_focus, new_focus, "avoid redundant watcher restarts")

old_switch = '''  async function switchTab(id: string) {
    const tab = tabs().find((candidate) => candidate.id === id);
    const pane = activePane();
    if (!tab || !pane || id === activeTabId()) return;
    setActiveTabId(id);
    setRenamePath(null);
    setRenamePaneId(null);
    await loadPane(pane.id, tab.path, { pushHistory: false, resetHistory: true, syncTab: false });
  }'''
new_switch = '''  async function switchTab(id: string) {
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
  }'''
app = replace_once(app, old_switch, new_switch, "restore tab history")

old_new_tab = '''  async function newTab() {
    const pane = activePane();
    const path = pane?.path ?? special()?.home;
    if (!path) return;
    const id = makeId();
    setTabs((current) => [...current, { id, title: pane?.title ?? "Scout", path, history: [path], historyIndex: 0 }]);
    setActiveTabId(id);
  }'''
new_new_tab = '''  async function newTab() {
    const pane = activePane();
    const path = pane?.path ?? special()?.home;
    if (!path) return;
    if (pane) syncTabToPane(pane);
    const id = makeId();
    setTabs((current) => [...current, { id, title: pane?.title ?? "Scout", path, history: [path], historyIndex: 0 }]);
    setActiveTabId(id);
    if (pane) updatePane(pane.id, (current) => ({ ...current, history: [path], historyIndex: 0, selected: [], selectionAnchor: null }));
  }'''
app = replace_once(app, old_new_tab, new_new_tab, "new tab independent history")

old_close = '''  async function closeTab(id: string) {
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
  }'''
new_close = '''  async function closeTab(id: string) {
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
  }'''
app = replace_once(app, old_close, new_close, "close tab history restore")

# Always expose the Workspaces create action, including when the list is empty.
old_workspaces = '''        <Show when={workspaces().length > 0}>
          <div class="sidebar-section-heading">
            <span class="sidebar-section-label">Workspaces</span>
            <button class="sidebar-section-action" onClick={saveWorkspace} aria-label="Save workspace" title="Save current workspace"><Icon name="plus" size={12} /></button>
          </div>
          <nav class="sidebar-nav workspace-list">
            <For each={workspaces()}>{(workspace) => (
              <div class="workspace-row">
                <button class="sidebar-item workspace-open" onClick={() => void restoreWorkspace(workspace)} title={workspace.panePaths.join("\\n")}>
                  <Icon name="split" size={14} />
                  <span>{workspace.name}</span>
                  <span class="workspace-count">{workspace.panePaths.length}</span>
                </button>
                <button class="workspace-delete" onClick={() => deleteWorkspace(workspace.id)} aria-label={`Delete ${workspace.name}`}><Icon name="close" size={11} /></button>
              </div>
            )}</For>
          </nav>
        </Show>'''
new_workspaces = '''        <div class="sidebar-section-heading">
          <span class="sidebar-section-label">Workspaces</span>
          <button class="sidebar-section-action" onClick={saveWorkspace} aria-label="Save workspace" title="Save current workspace"><Icon name="plus" size={12} /></button>
        </div>
        <Show when={workspaces().length > 0} fallback={<div class="workspace-empty">Save the current pane layout</div>}>
          <nav class="sidebar-nav workspace-list">
            <For each={workspaces()}>{(workspace) => (
              <div class="workspace-row">
                <button class="sidebar-item workspace-open" onClick={() => void restoreWorkspace(workspace)} title={workspace.panePaths.join("\\n")}>
                  <Icon name="split" size={14} />
                  <span>{workspace.name}</span>
                  <span class="workspace-count">{workspace.panePaths.length}</span>
                </button>
                <button class="workspace-delete" onClick={() => deleteWorkspace(workspace.id)} aria-label={`Delete ${workspace.name}`}><Icon name="close" size={11} /></button>
              </div>
            )}</For>
          </nav>
        </Show>'''
app = replace_once(app, old_workspaces, new_workspaces, "first workspace affordance")

# Search input ref for Cmd/Ctrl+F.
app = replace_once(
    app,
    '''  let refreshTimer: number | undefined;
  const paneLoadVersion = new Map<string, number>();''',
    '''  let refreshTimer: number | undefined;
  let searchInput: HTMLInputElement | undefined;
  const paneLoadVersion = new Map<string, number>();''',
    "search ref",
)
app = replace_once(
    app,
    '<input placeholder="Search" value={searchQuery()} onInput={(e) => setSearchQuery(e.currentTarget.value)} />',
    '<input ref={(node) => { searchInput = node; }} placeholder="Search" value={searchQuery()} onInput={(e) => setSearchQuery(e.currentTarget.value)} aria-label="Filter current folder" />',
    "search input ref",
)

# Add spatial keyboard navigation for icon/gallery views.
needle_move = '''  function moveKeyboardSelection(delta: number) {
    const pane = activePane();
    const entries = pane && pane.id === activePaneId() ? sortedEntries() : pane?.listing?.entries ?? [];
    if (!pane || !entries.length) return;
    const currentIndex = pane.selected.length ? entries.findIndex((entry) => entry.path === pane.selected[0]) : -1;
    const nextIndex = Math.min(Math.max(currentIndex + delta, 0), entries.length - 1);
    updatePane(pane.id, (current) => ({ ...current, selected: [entries[nextIndex].path], selectionAnchor: nextIndex }));
    document.querySelector<HTMLElement>(`.explorer-pane.active [data-entry-index="${nextIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }
'''
spatial = needle_move + '''
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
'''
app = replace_once(app, needle_move, spatial, "spatial keyboard navigation")

# Improve Finder-style keyboard shortcuts and direction-aware navigation.
old_key_start = '''    if (modifier && !event.shiftKey && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      const views: Record<string, ViewMode> = { "1": "icons", "2": "list", "3": "columns", "4": "gallery" };
      setView(views[event.key]);
    } else if (modifier && key === "a") {'''
new_key_start = '''    if (modifier && key === "f") {
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
    } else if (modifier && key === "a") {'''
app = replace_once(app, old_key_start, new_key_start, "Finder keyboard shortcuts")

old_arrows = '''    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveKeyboardSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveKeyboardSelection(-1);
    } else if (event.key === "Enter" && selected[0]) {'''
new_arrows = '''    } else if (event.key === "ArrowLeft" && (viewMode() === "icons" || viewMode() === "gallery")) {
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
    } else if (event.key === "Enter" && selected[0]) {'''
app = replace_once(app, old_arrows, new_arrows, "view-aware arrow navigation")

app_path.write_text(app)

# ---------------------------------------------------------------------------
# ColumnBrowser.tsx — current-folder filtering + metadata hydration
# ---------------------------------------------------------------------------
column_path = Path("src/components/ColumnBrowser.tsx")
column = column_path.read_text()
column = replace_once(
    column,
    'import { listDirectory } from "../lib/fs";',
    'import { hydrateDirectory, listDirectory } from "../lib/fs";',
    "columns hydrate import",
)
column = replace_once(
    column,
    '''  function sortedEntries(listing: DirectoryListing | undefined) {
    if (!listing) return [];
    const query = props.query.trim().toLowerCase();
    const entries = query ? listing.entries.filter((entry) => entry.name.toLowerCase().includes(query)) : [...listing.entries];''',
    '''  function sortedEntries(listing: DirectoryListing | undefined, columnPath?: string) {
    if (!listing) return [];
    const query = columnPath && comparePath(columnPath) === comparePath(props.path) ? props.query.trim().toLowerCase() : "";
    const entries = query ? listing.entries.filter((entry) => entry.name.toLowerCase().includes(query)) : [...listing.entries];''',
    "filter only current column",
)
column = column.replace('return sortedEntries(path ? listingFor(path) : undefined);', 'return sortedEntries(path ? listingFor(path) : undefined, path);')
column = column.replace('const previousEntries = sortedEntries(listingFor(paths()[previous]));', 'const previousEntries = sortedEntries(listingFor(paths()[previous]), paths()[previous]);')
column = column.replace('const entries = () => sortedEntries(listingFor(columnPath));', 'const entries = () => sortedEntries(listingFor(columnPath), columnPath);')

old_then = '''        .then((listing) => {
          if (token !== generation) return;
          setListings((current) => ({ ...current, [path]: listing }));
          setErrors((current) => ({ ...current, [path]: undefined }));
        })'''
new_then = '''        .then((listing) => {
          if (token !== generation) return;
          setListings((current) => ({ ...current, [path]: listing }));
          setErrors((current) => ({ ...current, [path]: undefined }));
          void hydrateDirectory(path, hidden)
            .then((hydrated) => {
              if (token !== generation) return;
              setListings((current) => ({ ...current, [path]: hydrated }));
            })
            .catch(() => {});
        })'''
column = replace_once(column, old_then, new_then, "hydrate ancestor columns")
column_path.write_text(column)

# ---------------------------------------------------------------------------
# preview.rs — heavy decode/base64 preview work off the Tauri command thread
# ---------------------------------------------------------------------------
preview_path = Path("src-tauri/src/preview.rs")
preview = preview_path.read_text()
preview = replace_once(
    preview,
    '''#[tauri::command]
pub fn thumbnail_entry(path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);''',
    '''fn thumbnail_entry_blocking(path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);''',
    "thumbnail blocking helper",
)
preview = replace_once(
    preview,
    '''#[tauri::command]
pub fn preview_entry(path: String) -> Result<PreviewData, String> {
    let path = PathBuf::from(path);''',
    '''fn preview_entry_blocking(path: String) -> Result<PreviewData, String> {
    let path = PathBuf::from(path);''',
    "preview blocking helper",
)
preview += '''

#[tauri::command]
pub async fn thumbnail_entry(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || thumbnail_entry_blocking(path))
        .await
        .map_err(|error| format!("Thumbnail worker failed: {error}"))?
}

#[tauri::command]
pub async fn preview_entry(path: String) -> Result<PreviewData, String> {
    tauri::async_runtime::spawn_blocking(move || preview_entry_blocking(path))
        .await
        .map_err(|error| format!("Preview worker failed: {error}"))?
}
'''
preview_path.write_text(preview)

print("Applied Scout quality pass")

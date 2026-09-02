from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

app_path = Path("src/App.tsx")
app = app_path.read_text()

app = replace_once(
    app,
    'const VIEW_KEY = "scout.view.v2";\n',
    'const VIEW_KEY = "scout.view.v2";\nconst BOOKMARKS_KEY = "scout.bookmarks.v1";\n',
    "bookmark key",
)

app = replace_once(
    app,
    '''interface SidebarItem {
  label: string;
  path: string;
  icon: IconName;
}
''',
    '''interface SidebarItem {
  label: string;
  path: string;
  icon: IconName;
}

interface SavedBookmark {
  id: string;
  label: string;
  path: string;
}
''',
    "bookmark type",
)

read_workspace_end = '''function readWorkspaces(): SavedWorkspace[] {
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
'''
bookmark_reader = read_workspace_end + '''
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
'''
app = replace_once(app, read_workspace_end, bookmark_reader, "bookmark reader")

app = replace_once(
    app,
    '  const [workspaces, setWorkspaces] = createSignal<SavedWorkspace[]>(readWorkspaces());\n',
    '  const [workspaces, setWorkspaces] = createSignal<SavedWorkspace[]>(readWorkspaces());\n  const [bookmarks, setBookmarks] = createSignal<SavedBookmark[]>(readBookmarks());\n',
    "bookmark signal",
)
app = replace_once(
    app,
    '  const [searchQuery, setSearchQuery] = createSignal("");\n',
    '  const [searchQuery, setSearchQuery] = createSignal("");\n  const [locationEditing, setLocationEditing] = createSignal(false);\n  const [locationValue, setLocationValue] = createSignal("");\n',
    "location state",
)
app = replace_once(
    app,
    '  let searchInput: HTMLInputElement | undefined;\n',
    '  let searchInput: HTMLInputElement | undefined;\n  let locationInput: HTMLInputElement | undefined;\n',
    "location ref",
)

persist_workspace = '''  function persistWorkspaces(next: SavedWorkspace[]) {
    setWorkspaces(next);
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(next));
  }
'''
bookmark_helpers = persist_workspace + '''
  function persistBookmarks(next: SavedBookmark[]) {
    setBookmarks(next);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  }

  function bookmarkLabel(path: string) {
    const parts = path.split(/[\\\\/]/).filter(Boolean);
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
    if (!trimmed.startsWith("~/") && !trimmed.startsWith("~\\\\")) return trimmed;
    const separator = home.includes("\\\\") ? "\\\\" : "/";
    const suffix = trimmed.slice(2).split(/[\\\\/]+/).filter(Boolean).join(separator);
    return suffix ? `${home.replace(/[\\\\/]$/, "")}${separator}${suffix}` : home;
  }

  async function commitLocationEdit() {
    const destination = resolveLocationInput(locationValue());
    setLocationEditing(false);
    if (!destination || comparablePath(destination) === comparablePath(activePane()?.path ?? "")) return;
    await navigate(destination);
  }
'''
app = replace_once(app, persist_workspace, bookmark_helpers, "bookmark/location helpers")

new_tab_block = '''  async function newTab() {
    const pane = activePane();
    const path = pane?.path ?? special()?.home;
    if (!path) return;
    if (pane) syncTabToPane(pane);
    const id = makeId();
    setTabs((current) => [...current, { id, title: pane?.title ?? "Scout", path, history: [path], historyIndex: 0 }]);
    setActiveTabId(id);
    if (pane) updatePane(pane.id, (current) => ({ ...current, history: [path], historyIndex: 0, selected: [], selectionAnchor: null }));
  }
'''
new_tab_plus = new_tab_block + '''
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
      title: loaded.displayName,
      path: loaded.path,
      history: [loaded.path],
      historyIndex: 0,
    } : tab));
  }
'''
app = replace_once(app, new_tab_block, new_tab_plus, "open directory in new tab")

# Cmd/Ctrl+L must be handled before ordinary commands; input handles its own keys while editing.
app = replace_once(
    app,
    '''    if (modifier && key === "f") {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (modifier && !event.shiftKey && ["1", "2", "3", "4"].includes(event.key)) {''',
    '''    if (modifier && key === "l") {
      event.preventDefault();
      startLocationEdit();
    } else if (modifier && key === "f") {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (modifier && !event.shiftKey && ["1", "2", "3", "4"].includes(event.key)) {''',
    "location shortcut",
)

# Sidebar bookmarks after Places.
places_block = '''        <nav class="sidebar-nav">
          <For each={sidebarItems()}>{(item) => (
            <button class="sidebar-item" classList={{ active: activePane()?.path === item.path }} onClick={() => navigate(item.path)} onMouseEnter={() => { void listDirectory(item.path, showHidden()).catch(()=>{}); }}>
              <Icon name={item.icon} size={15} /><span>{item.label}</span>
            </button>
          )}</For>
        </nav>

        <div class="sidebar-section-label" style="margin-top:14px">Locations</div>'''
places_plus = '''        <nav class="sidebar-nav">
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

        <div class="sidebar-section-label" style="margin-top:14px">Locations</div>'''
app = replace_once(app, places_block, places_plus, "bookmarks sidebar")

old_path = '''          <div class="path-display breadcrumbs" title={activePane()?.path ?? ""}>
            <Show when={breadcrumbs().length} fallback={"Loading…"}>
              <For each={breadcrumbs()}>{(crumb, i) => (
                <>
                  <button class="breadcrumb" onClick={() => navigate(crumb.path)}>{crumb.name || "/"}</button>
                  <Show when={i() < breadcrumbs().length - 1}><span class="breadcrumb-sep">›</span></Show>
                </>
              )}</For>
            </Show>
          </div>'''
new_path = '''          <div class="path-display breadcrumbs" title={activePane()?.path ?? ""}>
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
          </div>'''
app = replace_once(app, old_path, new_path, "editable location bar")

# Middle-click a folder to open it in a new tab in all non-Columns views.
app = replace_once(
    app,
    '''                      onDblClick={(e) => { e.preventDefault(); (e as any).stopPropagation(); setIsDragging(false); void activateEntry(pane.id, entry); }}
                      onContextMenu={(event) => {''',
    '''                      onDblClick={(e) => { e.preventDefault(); (e as any).stopPropagation(); setIsDragging(false); void activateEntry(pane.id, entry); }}
                      onAuxClick={(event) => {
                        if (event.button !== 1 || entry.kind !== "directory") return;
                        event.preventDefault();
                        event.stopPropagation();
                        focusPane(pane.id);
                        void openDirectoryInNewTab(entry);
                      }}
                      onContextMenu={(event) => {''',
    "middle-click tabs",
)

app = replace_once(
    app,
    '''                    onNavigateDirectory={(entry) => navigateColumnDirectory(pane.id, entry)}
                    onSelection={(paths, anchor) => updatePane(pane.id, (current) => ({ ...current, selected: paths, selectionAnchor: anchor }))}''',
    '''                    onNavigateDirectory={(entry) => navigateColumnDirectory(pane.id, entry)}
                    onOpenDirectoryInNewTab={(entry) => openDirectoryInNewTab(entry)}
                    onSelection={(paths, anchor) => updatePane(pane.id, (current) => ({ ...current, selected: paths, selectionAnchor: anchor }))}''',
    "columns open new tab prop",
)

app_path.write_text(app)

column_path = Path("src/components/ColumnBrowser.tsx")
column = column_path.read_text()
column = replace_once(
    column,
    '''  onNavigateDirectory: (entry: FsEntry) => void | Promise<void>;
  onSelection: (paths: string[], anchor: number | null) => void;''',
    '''  onNavigateDirectory: (entry: FsEntry) => void | Promise<void>;
  onOpenDirectoryInNewTab: (entry: FsEntry) => void | Promise<void>;
  onSelection: (paths: string[], anchor: number | null) => void;''',
    "columns new tab prop type",
)
column = replace_once(
    column,
    '''                    onDblClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (entry.kind !== "directory") void props.onOpenFile(entry);
                    }}
                    onContextMenu={(event) => {''',
    '''                    onDblClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (entry.kind !== "directory") void props.onOpenFile(entry);
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1 || entry.kind !== "directory") return;
                      event.preventDefault();
                      event.stopPropagation();
                      props.onFocus();
                      void props.onOpenDirectoryInNewTab(entry);
                    }}
                    onContextMenu={(event) => {''',
    "columns middle click tab",
)
column_path.write_text(column)
print("Added bookmarks, location entry, and folder tabs")

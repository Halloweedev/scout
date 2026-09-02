from pathlib import Path
import re

path = Path("src/App.tsx")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if text.count(old) != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {text.count(old)}")
    text = text.replace(old, new, 1)


def sub_once(pattern: str, replacement: str, label: str) -> None:
    global text
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")
    text = next_text

replace_once(
    '  copyEntries,\n  createFolder,\n  duplicateEntries,\n  getSpecialDirectories,\n  listDirectory,',
    '  clearDirCache,\n  copyEntries,\n  createFolder,\n  duplicateEntries,\n  getSpecialDirectories,\n  hydrateDirectory,\n  listDirectory,',
    'fs imports',
)

replace_once(
    'const WORKSPACES_KEY = "scout.workspaces.v1";\nconst LINKED_PANES_KEY = "scout.linked-panes.v1";',
    'const WORKSPACES_KEY = "scout.workspaces.v1";\nconst LINKED_PANES_KEY = "scout.linked-panes.v1";\nconst VIEW_KEY = "scout.view.v2";\n\ntype ViewMode = "icons" | "list" | "columns" | "gallery";',
    'view type',
)

sub_once(
    r'  const \[viewMode, setViewMode\] = createSignal<"list" \| "grid">\(\(\(\) => \{.*?  \}\)\(\)\);',
    '''  const [viewMode, setViewMode] = createSignal<ViewMode>((() => {
    const value = localStorage.getItem(VIEW_KEY) ?? localStorage.getItem("scout.view.v1");
    if (value === "grid" || value === "icons") return "icons";
    if (value === "columns" || value === "gallery") return value;
    return "list";
  })());''',
    'view signal',
)

replace_once(
    '  const [toolbarMenuOpen, setToolbarMenuOpen] = createSignal(false);',
    '  const [toolbarMenuOpen, setToolbarMenuOpen] = createSignal(false);\n  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);',
    'view menu signal',
)

replace_once(
    '  let stopFilesystemListener: (() => void) | undefined;\n  let refreshTimer: number | undefined;',
    '  let stopFilesystemListener: (() => void) | undefined;\n  let refreshTimer: number | undefined;\n  const paneLoadVersion = new Map<string, number>();',
    'load version state',
)

sub_once(
    r'  async function loadPane\(id: string, path: string, options: LoadPaneOptions = \{\}\) \{.*?\n  \}\n\n  async function navigate\(path: string\)',
    '''  async function loadPane(id: string, path: string, options: LoadPaneOptions = {}) {
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

  async function navigate(path: string)''',
    'loadPane',
)

replace_once(
    '''  async function reloadPane(id: string) {
    const pane = paneById(id);
    if (pane) await loadPane(id, pane.path, { pushHistory: false });
  }''',
    '''  async function reloadPane(id: string) {
    const pane = paneById(id);
    if (!pane) return;
    clearDirCache(pane.path);
    await loadPane(id, pane.path, { pushHistory: false });
  }''',
    'reload cache invalidation',
)

sub_once(
    r'  function cycleViewMode\(\) \{.*?\n  \}\n\n  function saveWorkspace\(\)',
    '''  function setView(next: ViewMode) {
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

  function saveWorkspace()''',
    'view helpers',
)

replace_once(
    '''  function closeContextMenu() {
    setContextMenu(null);
    setToolbarMenuOpen(false);
  }''',
    '''  function closeContextMenu() {
    setContextMenu(null);
    setToolbarMenuOpen(false);
    setViewMenuOpen(false);
  }''',
    'close menus',
)

replace_once(
    '''      setActiveListing(first);
      await watchDirectory(first.path);''',
    '''      setActiveListing(first);
      void hydrateDirectory(first.path, showHidden()).then((hydrated) => {
        const active = activePaneId();
        if (!active) return;
        updatePane(active, (candidate) => candidate.path === hydrated.path ? { ...candidate, listing: hydrated } : candidate);
        if (paneById(active)?.path === hydrated.path) setActiveListing(hydrated);
      }).catch(() => {});
      await watchDirectory(first.path);''',
    'initial hydration',
)

toolbar = '''            <div class="toolbar-view-group">
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
                  <button onClick={() => { setToolbarMenuOpen(false); void makeFolder(); }}><Icon name="new-folder" size={14} /> New folder</button>
                </div>
              </Show>
            </div>
'''

sub_once(
    r'            <div class="toolbar-view-group">.*?(?=            <button class="icon-button primary")',
    toolbar,
    'toolbar menus',
)

replace_once(
    '                <Show when={viewMode() === "list"}>',
    '                <Show when={pane.loading}><div class="directory-loading" aria-label="Loading folder"><span /></div></Show>\n                <Show when={viewMode() === "list"}>',
    'loading indicator',
)

replace_once(
    '                <div class={viewMode() === "grid" ? "file-grid" : "file-list"} style={zoom() !== 1 ? `zoom:${zoom()}` : ""} onPointerDown={(e) => handleRubberBandDown(pane.id, e as any)}>',
    '                <div class={viewContainerClass()} style={zoom() !== 1 ? `zoom:${zoom()}` : ""} onPointerDown={(e) => handleRubberBandDown(pane.id, e as any)}>',
    'view container',
)

replace_once(
    '                        grid: viewMode() === "grid",',
    '                        grid: viewMode() === "icons",\n                        columns: viewMode() === "columns",\n                        gallery: viewMode() === "gallery",',
    'view row classes',
)

replace_once(
    '<span class="file-icon"><Icon name={iconForEntry(entry)} size={viewMode()==="grid" ? 32 : 17} weight={entry.kind==="directory" ? "fill" : "regular"} /></span>',
    '<span class="file-icon"><Icon name={iconForEntry(entry)} size={viewMode()==="icons" ? 42 : viewMode()==="gallery" ? 64 : 17} weight={entry.kind==="directory" ? "fill" : "regular"} /></span>',
    'view icon sizes',
)

# Use the displayed/sorted order for keyboard selection and Select All.
text = text.replace(
    '    const entries = pane?.listing?.entries ?? [];',
    '    const entries = pane && pane.id === activePaneId() ? sortedEntries() : pane?.listing?.entries ?? [];',
    2,
)

replace_once(
    '          <div class="menu-separator" />\n          <button onClick={() => setContextMenu(null)}><Icon name="gear" size={14} /> Convert…</button>\n',
    '',
    'remove fake convert action',
)

path.write_text(text)
print("Patched src/App.tsx with Finder/Nautilus polish")

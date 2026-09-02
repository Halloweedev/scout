from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# ---- App.tsx ---------------------------------------------------------------
app_path = Path("src/App.tsx")
app = app_path.read_text()

app = replace_once(
    app,
    'import Icon, { type IconName } from "./components/Icon";\n',
    'import Icon, { type IconName } from "./components/Icon";\nimport ColumnBrowser from "./components/ColumnBrowser";\n',
    "ColumnBrowser import",
)

app = replace_once(
    app,
    '  silent?: boolean;\n}',
    '  silent?: boolean;\n  preserveColumnRoot?: boolean;\n}',
    "load pane option",
)

app = replace_once(
    app,
    '  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);\n',
    '  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);\n  const [columnRoots, setColumnRoots] = createSignal<Record<string, string>>({});\n',
    "column root state",
)

pane_helper = '''  function paneById(id: string) {
    return panes().find((pane) => pane.id === id) ?? null;
  }
'''
helper_replacement = pane_helper + '''
  function comparablePath(path: string) {
    const normalized = path.replace(/\\\\/g, "/").replace(/\\\/$/, "");
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
    const suffix = value.replace(/\\\\/g, "/").slice(source.replace(/\\\\/g, "/").replace(/\\\/$/, "").length);
    const separator = destination.includes("\\\\") ? "\\\\" : "/";
    return `${destination.replace(/[\\\\/]$/, "")}${suffix.replace(/\\//g, separator)}`;
  }

  function parentDirectory(path: string) {
    const separator = path.includes("\\\\") ? "\\\\" : "/";
    const trimmed = path.replace(/[\\\\/]+$/, "");
    const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\\\"));
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
'''
app = replace_once(app, pane_helper, helper_replacement, "pane helpers")

app = replace_once(
    app,
    '      updatePane(id, () => nextPane);\n\n      if (id === activePaneId()) {',
    '''      updatePane(id, () => nextPane);

      if (viewMode() === "columns") {
        const root = columnRoots()[id];
        if (!options.preserveColumnRoot || !root || !pathWithin(root, listing.path)) setColumnRoot(id, listing.path);
      }

      if (id === activePaneId()) {''',
    "loadPane column root",
)

app = replace_once(
    app,
    '''  async function navigate(path: string) {
    const id = activePaneId();
    if (id) await loadPane(id, path);
  }
''',
    '''  async function navigate(path: string) {
    const id = activePaneId();
    if (id) await loadPane(id, path);
  }

  async function navigateColumnDirectory(paneId: string, entry: FsEntry) {
    const loaded = await loadPane(paneId, entry.path, { preserveColumnRoot: true });
    if (!loaded) return;
    updatePane(paneId, (current) => ({ ...current, selected: [entry.path], selectionAnchor: null }));
  }
''',
    "column directory navigation",
)

app = replace_once(
    app,
    '    await loadPane(id, pane.path, { pushHistory: false });',
    '    await loadPane(id, pane.path, { pushHistory: false, preserveColumnRoot: viewMode() === "columns" });',
    "reload preserves columns",
)

# Up navigation: preserve the session root when the parent still sits under it.
app = app.replace(
    'await loadPane(pane.id, pane.listing.parentPath);',
    'await loadPane(pane.id, pane.listing.parentPath, { preserveColumnRoot: viewMode() === "columns" });',
)
app = app.replace(
    'await loadPane(candidate.id, parent, { silent: candidate.id !== pane.id, syncTab: candidate.id === pane.id });',
    'await loadPane(candidate.id, parent, { silent: candidate.id !== pane.id, syncTab: candidate.id === pane.id, preserveColumnRoot: viewMode() === "columns" });',
)

# History navigation should walk inside the existing column session when possible.
app = app.replace(
    'await loadPane(pane.id, path, { pushHistory: false, historyIndex: nextIndex });',
    'await loadPane(pane.id, path, { pushHistory: false, historyIndex: nextIndex, preserveColumnRoot: viewMode() === "columns" });',
)
app = replace_once(
    app,
    '''        silent: candidate.id !== pane.id,
        syncTab: candidate.id === pane.id,
      });''',
    '''        silent: candidate.id !== pane.id,
        syncTab: candidate.id === pane.id,
        preserveColumnRoot: viewMode() === "columns",
      });''',
    "linked history preserves columns",
)

app = replace_once(
    app,
    '''      setPanes((current) => [...current, pane]);
      setActivePaneId(pane.id);''',
    '''      setPanes((current) => [...current, pane]);
      if (viewMode() === "columns") setColumnRoot(pane.id, listing.path);
      setActivePaneId(pane.id);''',
    "new pane column root",
)

app = replace_once(
    app,
    '''    const remaining = current.filter((pane) => pane.id !== id);
    setPanes(remaining);''',
    '''    const remaining = current.filter((pane) => pane.id !== id);
    setPanes(remaining);
    setColumnRoots((roots) => {
      const next = { ...roots };
      delete next[id];
      return next;
    });''',
    "remove pane column root",
)

app = replace_once(
    app,
    '''  function setView(next: ViewMode) {
    setViewMode(next);
    localStorage.setItem(VIEW_KEY, next);
    setViewMenuOpen(false);
  }''',
    '''  function setView(next: ViewMode) {
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
  }''',
    "initialize columns view",
)

app = replace_once(
    app,
    '''    setPanes(restored);
    setActivePaneId(focused.id);''',
    '''    setPanes(restored);
    if (viewMode() === "columns") setColumnRoots(Object.fromEntries(restored.map((pane) => [pane.id, pane.path])));
    setActivePaneId(focused.id);''',
    "restore workspace roots",
)

app = replace_once(
    app,
    '''  function startRename(paneId: string, path: string) {
    const pane = paneById(paneId);
    const entry = pane?.listing?.entries.find((candidate) => candidate.path === path);
    if (!entry) return;
    focusPane(paneId);
    setRenamePaneId(paneId);
    setRenamePath(path);
    setRenameValue(entry.name);''',
    '''  function startRename(paneId: string, path: string) {
    const pane = paneById(paneId);
    const entry = pane?.listing?.entries.find((candidate) => candidate.path === path);
    const fallbackName = path.split(/[\\\\/]/).filter(Boolean).pop() ?? path;
    if (!entry && !fallbackName) return;
    focusPane(paneId);
    setRenamePaneId(paneId);
    setRenamePath(path);
    setRenameValue(entry?.name ?? fallbackName);''',
    "rename ancestor rows",
)

commit_pattern = re.compile(r'''  async function commitRename\(\) \{.*?\n  \}\n\n  async function duplicateSelection''', re.S)
match = commit_pattern.search(app)
if not match:
    raise SystemExit("commitRename block not found")
new_commit = '''  async function commitRename() {
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

  async function duplicateSelection'''
app = app[:match.start()] + new_commit + app[match.end():]

trash_pattern = re.compile(r'''  async function trashSelection\(\) \{.*?\n  \}\n\n  async function paste''', re.S)
match = trash_pattern.search(app)
if not match:
    raise SystemExit("trashSelection block not found")
new_trash = '''  async function trashSelection() {
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

  async function paste'''
app = app[:match.start()] + new_trash + app[match.end():]

# Replace each pane's current fake columns/list renderer with a dedicated column browser,
# keeping the existing renderer untouched as the fallback for Icons/List/Gallery.
main_pattern = re.compile(r'''              <main\n                class="file-area".*?              </main>''', re.S)
main_match = main_pattern.search(app)
if not main_match:
    raise SystemExit("pane main renderer not found")
old_main = main_match.group(0)
columns_main = '''              <Show when={viewMode() === "columns"} fallback={<>
''' + old_main + '''
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
                    onSelection={(paths, anchor) => updatePane(pane.id, (current) => ({ ...current, selected: paths, selectionAnchor: anchor }))}
                    onOpenFile={(entry) => openEntry(entry.path)}
                    onContextMenu={(event, entry, index) => {
                      focusPane(pane.id);
                      if (!pane.selected.includes(entry.path)) updatePane(pane.id, (current) => ({ ...current, selected: [entry.path], selectionAnchor: index }));
                      setContextMenu({ x: event.clientX, y: event.clientY, path: entry.path, paneId: pane.id });
                    }}
                  />
                </main>
              </Show>'''
app = app[:main_match.start()] + columns_main + app[main_match.end():]

app_path.write_text(app)

# ---- ColumnBrowser.tsx -----------------------------------------------------
column_path = Path("src/components/ColumnBrowser.tsx")
column = column_path.read_text()
column = replace_once(
    column,
    '''  onContextMenu: (event: MouseEvent, entry: FsEntry, index: number) => void;
}''',
    '''  onContextMenu: (event: MouseEvent, entry: FsEntry, index: number) => void;
  renamePath: string | null;
  renameValue: string;
  onRenameInput: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}''',
    "column rename props",
)

column = replace_once(
    column,
    '''  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [columnWidth, setColumnWidth] = createSignal<number>(() => {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= 190 && value <= 420 ? value : 244;
  });''',
    '''  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const initialColumnWidth = (() => {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= 190 && value <= 420 ? value : 244;
  })();
  const [columnWidth, setColumnWidth] = createSignal(initialColumnWidth);''',
    "column width initializer",
)

column = replace_once(
    column,
    '''                    <span class="column-browser-icon"><Icon name={iconForEntry(entry)} size={17} weight={entry.kind === "directory" ? "fill" : "regular"} /></span>
                    <span class="column-browser-name">{entry.name}</span>
                    <Show when={entry.kind === "directory"}><span class="column-browser-disclosure"><Icon name="chevron-right" size={12} /></span></Show>''',
    '''                    <span class="column-browser-icon"><Icon name={iconForEntry(entry)} size={17} weight={entry.kind === "directory" ? "fill" : "regular"} /></span>
                    <Show when={props.renamePath === entry.path} fallback={<span class="column-browser-name">{entry.name}</span>}>
                      <input
                        class="column-browser-rename"
                        value={props.renameValue}
                        ref={(input) => queueMicrotask(() => { input.focus(); input.select(); })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onInput={(event) => props.onRenameInput(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") props.onCommitRename();
                          if (event.key === "Escape") props.onCancelRename();
                        }}
                        onBlur={props.onCommitRename}
                      />
                    </Show>
                    <Show when={entry.kind === "directory"}><span class="column-browser-disclosure"><Icon name="chevron-right" size={12} /></span></Show>''',
    "inline column rename",
)
column_path.write_text(column)

# ---- Icon.tsx --------------------------------------------------------------
icon_path = Path("src/components/Icon.tsx")
icon = icon_path.read_text()
icon = replace_once(
    icon,
    '  CaretDownIcon as CaretDown,\n',
    '  CaretDownIcon as CaretDown,\n  CaretRightIcon as CaretRight,\n',
    "caret right import",
)
icon = replace_once(
    icon,
    '  | "chevron-down"\n',
    '  | "chevron-down"\n  | "chevron-right"\n',
    "caret right type",
)
icon = replace_once(
    icon,
    '''    case "chevron-down":
      return <CaretDown width={dim()} height={dim()} weight={weight()} class={cls()} />;''',
    '''    case "chevron-down":
      return <CaretDown width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "chevron-right":
      return <CaretRight width={dim()} height={dim()} weight={weight()} class={cls()} />;''',
    "caret right render",
)
icon_path.write_text(icon)

# ---- Quick Look: use row metadata directly so Column view works ------------
quick_path = Path("src/lib/quick-look.ts")
quick = quick_path.read_text()
quick = replace_once(
    quick,
    '''  const listing = getActiveListing();
  if (!row || !listing) return null;
  const index = Number(row.dataset.entryIndex);
  if (!Number.isInteger(index)) return null;
  return listing.entries[index]?.path ?? null;''',
    '''  if (!row) return null;
  const directPath = row.dataset.entryPath;
  if (directPath) return directPath;
  const listing = getActiveListing();
  if (!listing) return null;
  const index = Number(row.dataset.entryIndex);
  if (!Number.isInteger(index)) return null;
  return listing.entries[index]?.path ?? null;''',
    "Quick Look column path",
)
quick_path.write_text(quick)

# ---- CSS import ------------------------------------------------------------
index_path = Path("src/index.tsx")
index = index_path.read_text()
index = replace_once(
    index,
    'import "./view-polish.css";\n',
    'import "./view-polish.css";\nimport "./column-browser.css";\n',
    "column browser CSS import",
)
index_path.write_text(index)

# ---- Rename styling --------------------------------------------------------
css_path = Path("src/column-browser.css")
css = css_path.read_text()
css += '''\n.column-browser-rename {\n  min-width: 0;\n  height: 21px;\n  flex: 1 1 auto;\n  padding: 0 5px;\n  border: 1px solid rgba(10, 132, 255, 0.9);\n  border-radius: 4px;\n  outline: 0;\n  background: rgba(0, 0, 0, 0.34);\n  color: white;\n  font: inherit;\n  font-size: 11.5px;\n  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.18);\n}\n'''
css_path.write_text(css)

print("Integrated complete Finder-style Columns view")

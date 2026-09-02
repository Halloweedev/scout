from pathlib import Path
import json
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# App.tsx — startup recovery, shortcut ergonomics, workspace/watch hardening,
# and directory-specific context actions.
# ---------------------------------------------------------------------------
app_path = Path("src/App.tsx")
app = app_path.read_text()

app = replace_once(
    app,
    '  const [searchQuery, setSearchQuery] = createSignal("");\n',
    '  const [searchQuery, setSearchQuery] = createSignal("");\n  const [startupError, setStartupError] = createSignal<string | null>(null);\n',
    "startup error signal",
)

app = replace_once(
    app,
    '''  async function handleKeyDown(event: KeyboardEvent) {
    if (renamePath()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const selected = activeSelected();

    if (modifier && key === "l") {
      event.preventDefault();
      startLocationEdit();
    } else if (modifier && key === "f") {''',
    '''  async function handleKeyDown(event: KeyboardEvent) {
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

    if (modifier && key === "f") {''',
    "global location shortcut",
)

app = replace_once(
    app,
    '''    await watchDirectory(focused.path);
  }

  function selectEntry''',
    '''    await watchDirectory(focused.path).catch((reason) => {
      updatePane(focused.id, (current) => ({ ...current, error: String(reason) }));
    });
  }

  function selectEntry''',
    "workspace watcher error handling",
)

old_mount = '''  onMount(async () => {
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
  });'''
new_mount = '''  async function initializeApp() {
    setStartupError(null);
    try {
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
      void watchDirectory(first.path).catch((reason) => {
        updatePane(pane.id, (current) => ({ ...current, error: String(reason) }));
      });
    } catch (reason) {
      setStartupError(String(reason));
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scout:navigate", handleScoutNavigate);
    void listen("scout-fs-change", scheduleFilesystemRefresh)
      .then((cleanup) => { stopFilesystemListener = cleanup; })
      .catch(() => {
        // Browsing remains usable even if live refresh registration is unavailable.
      });
    void initializeApp();
  });'''
app = replace_once(app, old_mount, new_mount, "recoverable startup")

app = replace_once(
    app,
    '<Show when={searchQuery()}><button class="search-clear" onClick={() => setSearchQuery("")}><Icon name="close" size={12} /></button></Show>',
    '<Show when={searchQuery()}><button class="search-clear" onClick={() => setSearchQuery("")} aria-label="Clear folder filter"><Icon name="close" size={12} /></button></Show>',
    "search clear accessibility",
)

app = replace_once(
    app,
    '<div class={`pane-grid panes-${panes().length} view-${viewMode()}`}>\n          <For each={panes()}>{(pane) => (',
    '''<div class={`pane-grid panes-${Math.max(1, panes().length)} view-${viewMode()}`}>
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
          <For each={panes()}>{(pane) => (''',
    "startup state",
)

old_context = '''          <button onClick={() => { focusPane(menu().paneId); setClipboard({ mode: "copy", paths: paneById(menu().paneId)?.selected ?? [] }); setContextMenu(null); }}><Icon name="copy" size={14} />Copy</button>
          <button onClick={() => { focusPane(menu().paneId); setClipboard({ mode: "move", paths: paneById(menu().paneId)?.selected ?? [] }); setContextMenu(null); }}>Cut</button>
          <button onClick={() => startRename(menu().paneId, menu().path)}>Rename <kbd>F2</kbd></button>'''
new_context = '''          <Show when={paneById(menu().paneId)?.listing?.entries.find((entry) => entry.path === menu().path)}>{(entry) => (
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
          <button onClick={() => startRename(menu().paneId, menu().path)}>Rename <kbd>F2</kbd></button>'''
app = replace_once(app, old_context, new_context, "directory context actions")
app_path.write_text(app)


# ---------------------------------------------------------------------------
# Shared polish — location entry, startup recovery, disabled affordances.
# ---------------------------------------------------------------------------
css_path = Path("src/quality-polish.css")
css = css_path.read_text()
css += '''

/* Production navigation and startup states. */
.sidebar-section-action:disabled {
  opacity: 0.32;
  pointer-events: none;
}

.location-input {
  width: min(720px, 100%);
  height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  outline: none;
  background: rgba(255, 255, 255, 0.055);
  color: #eeeeef;
  font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  user-select: text;
  -webkit-user-select: text;
}

.location-input:focus {
  border-color: rgba(10, 132, 255, 0.46);
  background: rgba(255, 255, 255, 0.07);
}

.startup-state {
  display: flex;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 9px;
  padding: 40px;
  color: #9b9ba1;
  text-align: center;
}

.startup-state strong {
  color: #d7d7da;
  font-size: 12px;
  font-weight: 600;
}

.startup-message {
  max-width: 560px;
  color: #6f6f75;
  font-size: 10px;
  line-height: 1.45;
  user-select: text;
  -webkit-user-select: text;
}

.startup-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(255, 255, 255, 0.58);
  border-radius: 50%;
  animation: scout-startup-spin 700ms linear infinite;
}

.startup-retry {
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.055);
  color: #d8d8db;
}

.startup-retry:hover {
  background: rgba(255, 255, 255, 0.09);
}

@keyframes scout-startup-spin {
  to { transform: rotate(360deg); }
}
'''
css_path.write_text(css)


# ---------------------------------------------------------------------------
# Rust fs — remove legacy listing command, preserve symlinks during transfers,
# and avoid blocking Windows drive probes.
# ---------------------------------------------------------------------------
fs_path = Path("src-tauri/src/fs.rs")
fs_text = fs_path.read_text()

legacy_struct = '''#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    path: String,
    parent_path: Option<String>,
    display_name: String,
    entries: Vec<FsEntry>,
}

'''
fs_text = replace_once(fs_text, legacy_struct, "", "legacy directory listing type")

# Remove the unused synchronous list_directory command between special_directories and rename_entry.
pattern = re.compile(r'\n#\[tauri::command\]\npub fn list_directory\(path: String, show_hidden: bool\) -> Result<DirectoryListing, String> \{.*?\n\}\n\n(?=#\[tauri::command\]\npub fn rename_entry)', re.S)
fs_text, count = pattern.subn("\n", fs_text, count=1)
if count != 1:
    raise SystemExit(f"legacy list_directory: expected 1 match, found {count}")

copy_anchor = '''fn copy_path(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Copying symbolic links is not supported yet: {}", source.display()));
    }

    if metadata.is_dir() {'''
copy_replacement = '''#[cfg(unix)]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::unix::fs::symlink;
    let target = fs::read_link(source).map_err(|error| error.to_string())?;
    symlink(target, destination).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::fs::{symlink_dir, symlink_file, FileTypeExt};
    let target = fs::read_link(source).map_err(|error| error.to_string())?;
    let file_type = fs::symlink_metadata(source).map_err(|error| error.to_string())?.file_type();
    if file_type.is_symlink_dir() {
        symlink_dir(target, destination).map_err(|error| error.to_string())
    } else if file_type.is_symlink_file() {
        symlink_file(target, destination).map_err(|error| error.to_string())
    } else {
        Err(format!("Unsupported Windows reparse point: {}", source.display()))
    }
}

fn copy_path(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return copy_symlink(source, destination);
    }

    if metadata.is_dir() {'''
fs_text = replace_once(fs_text, copy_anchor, copy_replacement, "symlink copy")

old_windows = '''#[cfg(target_os = "windows")]
fn platform_locations(_home: &Path) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>) {
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\\\", letter as char));
        push_directory_if_present(&mut drives, root);
    }
    // The Windows Recycle Bin and network namespace are shell objects, not normal
    // directories Scout can safely enumerate through std::fs.
    (None, None, drives, None, None)
}
'''
new_windows = '''#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetLogicalDrives"]
    fn get_logical_drives() -> u32;
}

#[cfg(target_os = "windows")]
fn platform_locations(_home: &Path) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>) {
    let mask = unsafe { get_logical_drives() };
    let mut drives = Vec::new();
    for index in 0..26u8 {
        if mask & (1u32 << index) != 0 {
            drives.push(format!("{}:\\\\", (b'A' + index) as char));
        }
    }
    // Recycle Bin and network namespaces are shell objects rather than directories
    // Scout can safely enumerate through std::fs.
    (None, None, drives, None, None)
}
'''
fs_text = replace_once(fs_text, old_windows, new_windows, "native Windows drive discovery")

old_linux = '''#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_locations(home: &Path) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>) {
    let trash = home.join(".local/share/Trash/files");
    let mut drives = Vec::new();
    for root in [PathBuf::from("/media"), PathBuf::from("/mnt")] {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                push_directory_if_present(&mut drives, entry.path());
            }
        }
    }
    if let Ok(user) = std::env::var("USER") {
        let run_media = PathBuf::from("/run/media").join(user);
        if let Ok(entries) = fs::read_dir(run_media) {
            for entry in entries.flatten() {
                push_directory_if_present(&mut drives, entry.path());
            }
        }
    }
    (None, trash.is_dir().then(|| path_string(&trash)), drives, None, None)
}
'''
new_linux = '''#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_locations(home: &Path) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>) {
    let trash = home.join(".local/share/Trash/files");
    let mut drives = Vec::new();

    if let Ok(entries) = fs::read_dir("/mnt") {
        for entry in entries.flatten() {
            push_directory_if_present(&mut drives, entry.path());
        }
    }

    if let Some(user) = home.file_name() {
        for root in [PathBuf::from("/media").join(user), PathBuf::from("/run/media").join(user)] {
            if let Ok(entries) = fs::read_dir(root) {
                for entry in entries.flatten() {
                    push_directory_if_present(&mut drives, entry.path());
                }
            }
        }
    }

    (None, trash.is_dir().then(|| path_string(&trash)), drives, None, None)
}
'''
fs_text = replace_once(fs_text, old_linux, new_linux, "Linux mount discovery")

old_test = '''    #[cfg(unix)]
    #[test]
    fn failed_recursive_copy_removes_partial_destination() {
        use std::os::unix::fs::symlink;

        let root = test_directory("copy-cleanup");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).expect("create source");
        fs::write(source.join("ok.txt"), b"ok").expect("write source file");
        symlink(source.join("ok.txt"), source.join("link.txt")).expect("create symlink");

        assert!(copy_path(&source, &destination).is_err());
        assert!(!destination.exists());

        fs::remove_dir_all(root).expect("cleanup test directory");
    }
'''
new_test = '''    #[cfg(unix)]
    #[test]
    fn copies_symbolic_links_without_dereferencing() {
        use std::os::unix::fs::symlink;

        let root = test_directory("symlink-copy");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).expect("create source");
        fs::write(source.join("ok.txt"), b"ok").expect("write source file");
        symlink("ok.txt", source.join("link.txt")).expect("create symlink");

        copy_path(&source, &destination).expect("copy source with symlink");
        assert_eq!(fs::read_link(destination.join("link.txt")).expect("read copied symlink"), PathBuf::from("ok.txt"));
        assert_eq!(fs::read(destination.join("link.txt")).expect("follow copied symlink"), b"ok");

        fs::remove_dir_all(root).expect("cleanup test directory");
    }
'''
fs_text = replace_once(fs_text, old_test, new_test, "symlink test")
fs_path.write_text(fs_text)

lib_path = Path("src-tauri/src/lib.rs")
lib = lib_path.read_text()
lib = replace_once(lib, '            fs::list_directory,\n', '', "legacy list command registration")
lib_path.write_text(lib)


# ---------------------------------------------------------------------------
# Tauri security — enable a restrictive local-only CSP while retaining IPC,
# data/blob previews, and inline component styles.
# ---------------------------------------------------------------------------
conf_path = Path("src-tauri/tauri.conf.json")
conf = json.loads(conf_path.read_text())
conf["app"]["security"]["csp"] = {
    "default-src": "'self'",
    "connect-src": "ipc: http://ipc.localhost",
    "img-src": "'self' data: blob:",
    "media-src": "'self' data: blob:",
    "frame-src": "'self' data: blob:",
    "style-src": "'self' 'unsafe-inline'",
    "worker-src": "'self' blob:",
    "object-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'",
}
conf_path.write_text(json.dumps(conf, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Runtime smoke — exercise location entry/tabs and support release binaries.
# ---------------------------------------------------------------------------
smoke_path = Path("scripts/runtime_smoke_linux.sh")
smoke = smoke_path.read_text()
smoke = replace_once(
    smoke,
    'BINARY="$ROOT_DIR/src-tauri/target/debug/scout"',
    'BINARY="${SCOUT_BINARY:-$ROOT_DIR/src-tauri/target/debug/scout}"',
    "runtime binary override",
)
smoke = replace_once(
    smoke,
    '''xdotool windowfocus "$WINDOW_ID" || true
sleep 1

# Finder-compatible view shortcuts: 1 Icons, 2 List, 3 Columns, 4 Gallery.''',
    '''xdotool windowfocus "$WINDOW_ID" || true
sleep 1

# Global editable location entry must work even in a keyboard-first flow.
xdotool key --window "$WINDOW_ID" ctrl+l
sleep 0.3
xdotool type --window "$WINDOW_ID" --clearmodifiers '~/A-Folder'
xdotool key --window "$WINDOW_ID" Return
sleep 0.8
xdotool key --window "$WINDOW_ID" ctrl+l
sleep 0.3
xdotool type --window "$WINDOW_ID" --clearmodifiers '~'
xdotool key --window "$WINDOW_ID" Return
sleep 0.8

# Tabs must create and close without disturbing the current folder.
xdotool key --window "$WINDOW_ID" ctrl+t
sleep 0.4
xdotool key --window "$WINDOW_ID" ctrl+w
sleep 0.5

if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
  echo "Scout crashed during location/tab navigation." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

# Finder-compatible view shortcuts: 1 Icons, 2 List, 3 Columns, 4 Gallery.''',
    "location/tab runtime smoke",
)
smoke = replace_once(
    smoke,
    '''echo "Scout runtime smoke passed. Window=$WINDOW_ID PID=$SCOUT_PID"
echo "Screenshot: $SCREENSHOT_PATH"''',
    '''if grep -Eqi 'panicked at|thread .* panicked|fatal error|segmentation fault' "$LOG_PATH"; then
  echo "Scout runtime log contains a fatal error." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

echo "Scout runtime smoke passed. Window=$WINDOW_ID PID=$SCOUT_PID"
echo "Screenshot: $SCREENSHOT_PATH"''',
    "fatal log check",
)
smoke_path.write_text(smoke)


# ---------------------------------------------------------------------------
# Release workflows — smoke the actual release executable on Linux before
# publishing candidates or releases.
# ---------------------------------------------------------------------------
for workflow_name in [".github/workflows/release.yml", ".github/workflows/release-candidate.yml"]:
    path = Path(workflow_name)
    text = path.read_text()
    text = replace_once(
        text,
        'run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf',
        'run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xvfb xdotool imagemagick',
        f"{workflow_name} Linux smoke dependencies",
    )
    text = replace_once(
        text,
        '''      - name: Build release bundle
        run: pnpm tauri build --bundles ${{ matrix.bundle }}
      - name: Upload''',
        '''      - name: Build release bundle
        run: pnpm tauri build --bundles ${{ matrix.bundle }}
      - name: Smoke release binary
        if: runner.os == 'Linux'
        env:
          SCOUT_BINARY: ${{ github.workspace }}/src-tauri/target/release/scout
        run: bash scripts/runtime_smoke_linux.sh
      - name: Upload''',
        f"{workflow_name} release runtime smoke",
    )
    path.write_text(text)


# ---------------------------------------------------------------------------
# README — make public project status match the actual shipped baseline.
# ---------------------------------------------------------------------------
readme = '''# Scout

**The open-source power tool for your files.**

Scout is a local-first, cross-platform power file manager for macOS, Windows, and Linux. It combines familiar file-manager navigation with multi-pane workflows, fast previews, search, utilities, an operation queue, and Hazel-style automation.

Scout is built with **Rust + Tauri 2 + SolidJS + TypeScript**. Files stay on your machine unless you explicitly use an external tool yourself.

## Current status

The M1–M5 implementation baseline is complete and the repository is maintained as a production candidate. Every push to `main` type-checks/builds the frontend, runs Rust checks and tests on macOS/Windows/Linux, builds installable packages, and launches the real Linux desktop app through an automated runtime smoke test.

### Daily-driver filesystem

- Native directory browsing with fast first paint and background metadata hydration.
- Back / forward / parent navigation and editable location entry (`Cmd/Ctrl+L`).
- Tabs with independent history, folder bookmarks, and 1–4 explorer panes.
- Linked pane navigation and persistent workspaces.
- Icons, List, Miller Columns, and Gallery views.
- Multi-selection, rubber-band selection, keyboard navigation, inline rename, copy/cut/paste, duplicate, create folder, native Trash, and drag/drop.
- Native filesystem watching with debounced refresh.
- Cross-platform special locations and mounted-drive discovery.

### Search and previews

- Persistent SQLite-backed fuzzy file index with usage, recency, and path-aware ranking.
- Bounded local content search and saved searches.
- Quick Look for folders, images + EXIF, text/code, rendered Markdown, PDFs, audio, video, and ZIP archives.
- Lazy image thumbnails with bounded concurrency and memory.

### Power tools

- Batch rename, SHA-256 checksums, exact duplicate detection, similar-photo search, and folder-size treemap.
- ZIP create/extract and read-only archive browsing.
- Native image resize/convert/optimize and PDF operations.
- Optional FFmpeg, Pandoc, and LibreOffice conversions when those tools are installed locally.
- Portal shelf and Open Terminal Here.

### Operations and automation

- Shared persistent Operations queue with progress, cancellation, failure states, and bounded history.
- Footprints operation history plus undo/redo for reversible filesystem actions.
- Persisted Hazel-style rules with dry runs, live filesystem triggers, loop suppression, and actions for move/copy/rename/tag/convert/optimize/archive/program execution.
- Scout-native cross-platform tags.

See [ROADMAP.md](ROADMAP.md) for the completed milestone checklist and remaining intentional limitations.

## Development

Requirements: a current Node.js release, pnpm, Rust stable, and the platform prerequisites for Tauri 2.

```bash
pnpm install
pnpm tauri dev
```

Frontend-only development:

```bash
pnpm dev
```

Production checks:

```bash
pnpm build
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

## Releases

Scout's release workflow builds `.dmg`, `.exe` (NSIS), and `.deb` installers from version tags. Repository versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` must match the tag.

Supported tags:

```text
vX.Y.Z-alpha.N
vX.Y.Z-beta.N
vX.Y.Z
```

The Linux release executable is launched and exercised before a candidate or GitHub release is accepted. macOS/Windows trusted public distribution additionally requires the appropriate platform signing/notarization credentials to be configured by the distributor.

## Security

- Local-only frontend assets with an explicit Tauri Content Security Policy.
- No remote script/CDN dependencies in the desktop webview.
- Native commands are capability-scoped to the Scout desktop window.
- Automation program actions launch argument vectors directly rather than evaluating shell strings.

## License

Scout is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE.md](LICENSE.md).
'''
Path("README.md").write_text(readme)

print("Applied Scout production hardening")

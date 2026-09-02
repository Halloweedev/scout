from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

# App: Finder-compatible view keyboard shortcuts.
app_path = Path("src/App.tsx")
app = app_path.read_text()
needle = '''    if (modifier && key === "a") {
      event.preventDefault();
      const pane = activePane();'''
replacement = '''    if (modifier && !event.shiftKey && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      const views: Record<string, ViewMode> = { "1": "icons", "2": "list", "3": "columns", "4": "gallery" };
      setView(views[event.key]);
    } else if (modifier && key === "a") {
      event.preventDefault();
      const pane = activePane();'''
app = replace_once(app, needle, replacement, "Finder view shortcuts")
app_path.write_text(app)

# ColumnBrowser: avoid duplicate history loads on ArrowRight and clear selection on blank column space.
column_path = Path("src/components/ColumnBrowser.tsx")
column = column_path.read_text()
old_right = '''      if (selected?.kind === "directory") {
        void props.onNavigateDirectory(selected);
        setFocusedColumn(Math.min(columnIndex + 1, paths().length));
        scrollToEnd();
      } else if (columnIndex < paths().length - 1) {
        setFocusedColumn(columnIndex + 1);
      }'''
new_right = '''      if (selected?.kind === "directory") {
        const existingChild = paths()[columnIndex + 1];
        if (!existingChild || comparePath(existingChild) !== comparePath(selected.path)) {
          void props.onNavigateDirectory(selected);
        }
        setFocusedColumn(columnIndex + 1);
        scrollToEnd();
      } else if (columnIndex < paths().length - 1) {
        setFocusedColumn(columnIndex + 1);
      }'''
column = replace_once(column, old_right, new_right, "ArrowRight duplicate navigation")
old_list = '<div class="column-browser-list">\n              <For each={entries()}>'
new_list = '''<div
              class="column-browser-list"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  props.onFocus();
                  setFocusedColumn(columnIndex());
                  props.onSelection([], null);
                  setPreviewPath(null);
                }
              }}
            >
              <For each={entries()}>'''
column = replace_once(column, old_list, new_list, "blank column selection")
column_path.write_text(column)

# CI: install runtime UI tooling, run actual Tauri window smoke, upload evidence.
ci_path = Path(".github/workflows/ci.yml")
ci = ci_path.read_text()
ci = replace_once(
    ci,
    'run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf',
    'run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xvfb xdotool imagemagick',
    "Linux smoke dependencies",
)
old_bundle = '''      - name: Build installable bundle
        run: pnpm tauri build --debug --bundles ${{ matrix.bundle }}
      - name: Upload installable bundle'''
new_bundle = '''      - name: Build installable bundle
        run: pnpm tauri build --debug --bundles ${{ matrix.bundle }}
      - name: Run real app runtime smoke
        if: runner.os == 'Linux'
        run: bash scripts/runtime_smoke_linux.sh
      - name: Upload runtime smoke evidence
        if: runner.os == 'Linux' && always()
        uses: actions/upload-artifact@v4
        with:
          name: scout-Linux-runtime-smoke
          path: |
            ${{ runner.temp }}/scout-runtime-smoke.png
            ${{ runner.temp }}/scout-runtime.log
          if-no-files-found: warn
          retention-days: 7
      - name: Upload installable bundle'''
ci = replace_once(ci, old_bundle, new_bundle, "runtime smoke CI")
ci_path.write_text(ci)

print("Applied Finder view shortcuts and real runtime smoke integration")

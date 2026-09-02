from pathlib import Path

path = Path("src/App.tsx")
text = path.read_text()
old = '''  const sortedEntries = createMemo(() => {
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
  });'''
new = '''  function sortEntries(entries: FsEntry[]) {
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
  const sortedEntries = createMemo(() => sortEntries(filteredEntries()));'''
if text.count(old) != 1:
    raise SystemExit(f"sort block: expected one match, found {text.count(old)}")
text = text.replace(old, new, 1)
old_render = '''<For each={(pane.id === activePaneId() ? sortedEntries() : pane.listing?.entries ?? []) as any}>'''
new_render = '''<For each={(pane.id === activePaneId() ? sortedEntries() : sortEntries(pane.listing?.entries ?? [])) as any}>'''
if text.count(old_render) != 1:
    raise SystemExit(f"pane render: expected one match, found {text.count(old_render)}")
text = text.replace(old_render, new_render, 1)
old_watch = '''      void watchDirectory(next.path);'''
new_watch = '''      void watchDirectory(next.path).catch((reason) => {
        updatePane(next.id, (current) => ({ ...current, error: String(reason) }));
      });'''
if text.count(old_watch) != 1:
    raise SystemExit(f"remove-pane watcher: expected one match, found {text.count(old_watch)}")
text = text.replace(old_watch, new_watch, 1)
path.write_text(text)
print("Applied multi-pane sorting and watcher hardening")

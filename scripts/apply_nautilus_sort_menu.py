from pathlib import Path

path = Path("src/App.tsx")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if text.count(old) != 1:
        raise SystemExit(f"{label}: expected 1 match, found {text.count(old)}")
    text = text.replace(old, new, 1)

replace_once(
    '  const [sortBy, setSortBy] = createSignal<"name" | "modified" | "size">("name");',
    '  const [sortBy, setSortBy] = createSignal<"name" | "modified" | "size" | "type">("name");',
    'sort type',
)

replace_once(
    '''      if (by === "name") return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
      if (by === "size") return ((a.size ?? -1) - (b.size ?? -1)) * dir;
      return ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) * dir;''',
    '''      if (by === "name") return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
      if (by === "size") return ((a.size ?? -1) - (b.size ?? -1)) * dir;
      if (by === "type") {
        const aType = `${a.kind}:${a.extension ?? ""}:${a.name}`.toLowerCase();
        const bType = `${b.kind}:${b.extension ?? ""}:${b.name}`.toLowerCase();
        return aType.localeCompare(bType) * dir;
      }
      return ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) * dir;''',
    'type sorting',
)

replace_once(
    '  const toggleSort = (by: "name" | "modified" | "size") => {',
    '  const toggleSort = (by: "name" | "modified" | "size" | "type") => {',
    'toggle sort type',
)

replace_once(
    '''                  <button onClick={() => { setToolbarMenuOpen(false); void toggleHiddenFiles(); }}><Icon name={showHidden() ? "eye-slash" : "eye"} size={14} /> {showHidden() ? "Hide hidden files" : "Show hidden files"}</button>
                  <div class="menu-separator" />
                  <button onClick={() => { setToolbarMenuOpen(false); void makeFolder(); }}><Icon name="new-folder" size={14} /> New folder</button>''',
    '''                  <button onClick={() => { setToolbarMenuOpen(false); void toggleHiddenFiles(); }}><Icon name={showHidden() ? "eye-slash" : "eye"} size={14} /> {showHidden() ? "Hide hidden files" : "Show hidden files"}</button>
                  <div class="menu-separator" />
                  <button onClick={() => { setSortBy("name"); setSortDir("asc"); }}><span class="menu-check-slot">{sortBy() === "name" ? "✓" : ""}</span> Sort by Name</button>
                  <button onClick={() => { setSortBy("modified"); setSortDir("desc"); }}><span class="menu-check-slot">{sortBy() === "modified" ? "✓" : ""}</span> Sort by Modified</button>
                  <button onClick={() => { setSortBy("size"); setSortDir("asc"); }}><span class="menu-check-slot">{sortBy() === "size" ? "✓" : ""}</span> Sort by Size</button>
                  <button onClick={() => { setSortBy("type"); setSortDir("asc"); }}><span class="menu-check-slot">{sortBy() === "type" ? "✓" : ""}</span> Sort by Type</button>
                  <button onClick={() => setSortDir(sortDir() === "asc" ? "desc" : "asc")}><span class="menu-check-slot">{sortDir() === "desc" ? "✓" : ""}</span> Reverse order</button>
                  <div class="menu-separator" />
                  <button onClick={() => { setToolbarMenuOpen(false); void makeFolder(); }}><Icon name="new-folder" size={14} /> New folder</button>''',
    'sort menu',
)

path.write_text(text)
print("Added Nautilus-style sort controls")

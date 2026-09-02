from pathlib import Path

path = Path("src/App.tsx")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if text.count(old) != 1:
        raise SystemExit(f"{label}: expected 1 match, found {text.count(old)}")
    text = text.replace(old, new, 1)

replace_once(
    '''    try {
      const listing = await listDirectory(path, showHidden());
      const pane = paneFromListing(listing);
      setPanes((current) => [...current, pane]);
      setActivePaneId(pane.id);
      setActiveListing(listing);
      syncTabToPane(pane);
      await watchDirectory(listing.path);''',
    '''    try {
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
      await watchDirectory(listing.path);''',
    'add pane hydration',
)

replace_once(
    '''    setActivePaneId(focused.id);
    setActiveListing(focused.listing);
    syncTabToPane(focused);
    await watchDirectory(focused.path);''',
    '''    setActivePaneId(focused.id);
    setActiveListing(focused.listing);
    syncTabToPane(focused);
    for (const pane of restored) {
      void hydrateDirectory(pane.path, workspace.showHidden).then((hydrated) => {
        updatePane(pane.id, (candidate) => candidate.path === hydrated.path ? { ...candidate, listing: hydrated } : candidate);
        if (activePaneId() === pane.id) setActiveListing(hydrated);
      }).catch(() => {});
    }
    await watchDirectory(focused.path);''',
    'workspace hydration',
)

path.write_text(text)
print("Added metadata hydration for added/restored panes")

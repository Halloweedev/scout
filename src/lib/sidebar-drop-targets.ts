import { invoke } from "@tauri-apps/api/core";

interface SpecialDirectories {
  home: string;
  desktop: string | null;
  documents: string | null;
  downloads: string | null;
  pictures: string | null;
  music: string | null;
  movies: string | null;
  trash: string | null;
  icloud: string | null;
  drives: string[];
  network: string | null;
  applications: string | null;
}

let observer: MutationObserver | null = null;
let locations = new Map<string, string>();
let disposed = false;

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function addUnique(map: Map<string, string | null>, label: string, path: string | null | undefined) {
  if (!path) return;
  if (!map.has(label)) {
    map.set(label, path);
    return;
  }
  if (map.get(label) !== path) map.set(label, null);
}

function locationMap(dirs: SpecialDirectories) {
  const candidates = new Map<string, string | null>();
  addUnique(candidates, "Home", dirs.home);
  addUnique(candidates, "Desktop", dirs.desktop);
  addUnique(candidates, "Documents", dirs.documents);
  addUnique(candidates, "Downloads", dirs.downloads);
  addUnique(candidates, "Pictures", dirs.pictures);
  addUnique(candidates, "Music", dirs.music);
  addUnique(candidates, "Movies", dirs.movies);
  addUnique(candidates, "iCloud Drive", dirs.icloud);
  addUnique(candidates, "Applications", dirs.applications);
  addUnique(candidates, "Network", dirs.network);
  addUnique(candidates, "Trash", dirs.trash);

  const normalizedHome = dirs.home.replace(/\\/g, "/");
  const windowsDrive = /^([a-zA-Z]:)\//.exec(normalizedHome)?.[1] ?? null;
  const rootPath = windowsDrive ? `${windowsDrive}\\` : "/";
  const rootLabel = windowsDrive ? windowsDrive : normalizedHome.startsWith("/Users/") ? "Macintosh HD" : "Computer";
  addUnique(candidates, rootLabel, rootPath);

  for (const drive of dirs.drives ?? []) addUnique(candidates, basename(drive), drive);

  return new Map([...candidates].filter((entry): entry is [string, string] => !!entry[1]));
}

function buttonLabel(button: HTMLElement) {
  const label = button.querySelector("span")?.textContent?.trim() ?? button.textContent?.trim() ?? "";
  return label;
}

function decorate() {
  if (disposed) return;
  for (const button of document.querySelectorAll<HTMLElement>(".sidebar-item")) {
    delete button.dataset.scoutDropPath;
    delete button.dataset.scoutDropLabel;

    if (button.closest(".bookmark-row")) {
      const path = button.getAttribute("title")?.trim();
      if (!path) continue;
      button.dataset.scoutDropPath = path;
      button.dataset.scoutDropLabel = buttonLabel(button) || basename(path);
      continue;
    }

    if (button.classList.contains("workspace-open")) continue;
    const label = buttonLabel(button);
    const path = locations.get(label);
    if (!path) continue;
    button.dataset.scoutDropPath = path;
    button.dataset.scoutDropLabel = label || basename(path);
  }
}

function scheduleDecorate() {
  queueMicrotask(decorate);
}

export function installSidebarDropTargets() {
  disposed = false;
  void invoke<SpecialDirectories>("special_directories")
    .then((dirs) => {
      if (disposed) return;
      locations = locationMap(dirs);
      decorate();
    })
    .catch(() => {
      locations = new Map();
    });

  observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    disposed = true;
    observer?.disconnect();
    observer = null;
    locations.clear();
    document.querySelectorAll<HTMLElement>("[data-scout-drop-path]").forEach((node) => {
      delete node.dataset.scoutDropPath;
      delete node.dataset.scoutDropLabel;
    });
  };
}

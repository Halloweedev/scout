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

const SPRING_DELAY_MS = 720;

let observer: MutationObserver | null = null;
let locations = new Map<string, string>();
let trashPath = "";
let disposed = false;
let springTimer: number | null = null;
let springTarget: HTMLElement | null = null;

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

  // Virtual Network roots deliberately stay out of generic Move/Copy drops because
  // they are not guaranteed to be writable filesystem destinations on every platform.
  const normalizedHome = dirs.home.replace(/\\/g, "/");
  const windowsDrive = /^([a-zA-Z]:)\//.exec(normalizedHome)?.[1] ?? null;
  const rootPath = windowsDrive ? `${windowsDrive}\\` : "/";
  const rootLabel = windowsDrive ? windowsDrive : normalizedHome.startsWith("/Users/") ? "Macintosh HD" : "Computer";
  addUnique(candidates, rootLabel, rootPath);

  for (const drive of dirs.drives ?? []) addUnique(candidates, basename(drive), drive);

  return new Map([...candidates].filter((entry): entry is [string, string] => !!entry[1]));
}

function buttonLabel(button: HTMLElement) {
  return button.querySelector("span")?.textContent?.trim() ?? button.textContent?.trim() ?? "";
}

function clearTarget(button: HTMLElement) {
  delete button.dataset.scoutDropPath;
  delete button.dataset.scoutDropLabel;
  delete button.dataset.scoutDropAction;
}

function decorate() {
  if (disposed) return;
  for (const button of document.querySelectorAll<HTMLElement>(".sidebar-item")) {
    clearTarget(button);

    if (button.closest(".bookmark-row")) {
      const path = button.getAttribute("title")?.trim();
      if (!path) continue;
      button.dataset.scoutDropPath = path;
      button.dataset.scoutDropLabel = buttonLabel(button) || basename(path);
      continue;
    }

    if (button.classList.contains("workspace-open")) continue;
    const label = buttonLabel(button);
    if (label === "Trash" && trashPath) {
      button.dataset.scoutDropPath = trashPath;
      button.dataset.scoutDropLabel = "Trash";
      button.dataset.scoutDropAction = "trash";
      continue;
    }

    const path = locations.get(label);
    if (!path) continue;
    button.dataset.scoutDropPath = path;
    button.dataset.scoutDropLabel = label || basename(path);
  }
}

function scheduleDecorate() {
  queueMicrotask(decorate);
}

function clearSpring() {
  if (springTimer !== null) window.clearTimeout(springTimer);
  springTimer = null;
  springTarget?.classList.remove("internal-drop-spring");
  springTarget = null;
}

function hoveredSidebarTarget(event: PointerEvent) {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  return hit?.closest<HTMLElement>(".sidebar-item[data-scout-drop-path]") ?? null;
}

function handlePointerMove(event: PointerEvent) {
  if (!document.documentElement.classList.contains("internal-file-drag")) {
    clearSpring();
    return;
  }

  const target = hoveredSidebarTarget(event);
  if (!target || target.dataset.scoutDropAction === "trash" || target.classList.contains("active")) {
    clearSpring();
    return;
  }
  if (springTarget === target) return;

  clearSpring();
  springTarget = target;
  target.classList.add("internal-drop-spring");
  springTimer = window.setTimeout(() => {
    springTimer = null;
    const button = springTarget;
    if (!button || !button.isConnected || button.dataset.scoutDropAction === "trash") {
      clearSpring();
      return;
    }
    button.classList.remove("internal-drop-spring");
    springTarget = null;
    button.click();
  }, SPRING_DELAY_MS);
}

export function installSidebarDropTargets() {
  disposed = false;
  void invoke<SpecialDirectories>("special_directories")
    .then((dirs) => {
      if (disposed) return;
      locations = locationMap(dirs);
      trashPath = dirs.trash ?? "";
      decorate();
    })
    .catch(() => {
      locations = new Map();
      trashPath = "";
    });

  observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", clearSpring);
  window.addEventListener("pointercancel", clearSpring);

  return () => {
    disposed = true;
    observer?.disconnect();
    observer = null;
    clearSpring();
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", clearSpring);
    window.removeEventListener("pointercancel", clearSpring);
    locations.clear();
    trashPath = "";
    document.querySelectorAll<HTMLElement>(".sidebar-item[data-scout-drop-path], .sidebar-item[data-scout-drop-action]").forEach(clearTarget);
  };
}

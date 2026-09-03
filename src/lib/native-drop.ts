import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { copyEntries, getActiveDirectory, trashEntries } from "./fs";

const DROP_CLASS = "native-file-drop";
const SPRING_DELAY_MS = 720;

type NativeDropAction = "copy" | "trash" | "portal";

interface NativeDestination {
  action: NativeDropAction;
  path: string | null;
  label: string;
  element: HTMLElement | null;
  valid: boolean;
  spring: "open" | "click" | null;
}

let activeTarget: HTMLElement | null = null;
let springTimer: number | null = null;
let springTarget: HTMLElement | null = null;
let draggedPaths: string[] = [];

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
}

function pathWithin(root: string, value: string) {
  const a = comparablePath(root);
  const b = comparablePath(value);
  return a === b || b.startsWith(a === "/" ? "/" : `${a}/`);
}

function basename(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function toast(message: string, error = false) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message, error } }));
}

function setDropActive(active: boolean) {
  document.documentElement.classList.toggle(DROP_CLASS, active);
}

function clearSpring() {
  if (springTimer !== null) window.clearTimeout(springTimer);
  springTimer = null;
  springTarget?.classList.remove("native-drop-spring");
  springTarget = null;
}

function clearTarget() {
  activeTarget?.classList.remove("native-drop-target", "native-drop-invalid", "native-drop-copy", "native-drop-trash", "native-drop-portal");
  activeTarget?.removeAttribute("data-native-drop-intent");
  activeTarget = null;
}

function clearDragState() {
  setDropActive(false);
  clearSpring();
  clearTarget();
  draggedPaths = [];
}

function regularDestinationValid(path: string) {
  return !draggedPaths.some((source) => pathWithin(source, path));
}

function resolveDestination(x: number, y: number): NativeDestination | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;

  const portal = hit.closest<HTMLElement>(".portal-panel, .portal-body");
  if (portal) {
    return { action: "portal", path: null, label: "Portal", element: portal, valid: true, spring: null };
  }

  const direct = hit.closest<HTMLElement>("[data-scout-drop-path]");
  const directPath = direct?.dataset.scoutDropPath;
  if (direct && directPath) {
    if (direct.dataset.scoutDropAction === "trash") {
      return { action: "trash", path: directPath, label: "Trash", element: direct, valid: true, spring: null };
    }
    const spring = direct.dataset.scoutDropAction === "tab" || direct.classList.contains("sidebar-item") ? "click" : null;
    return {
      action: "copy",
      path: directPath,
      label: direct.dataset.scoutDropLabel || basename(directPath),
      element: direct,
      valid: regularDestinationValid(directPath),
      spring,
    };
  }

  const row = hit.closest<HTMLElement>(".pane-file-row[data-entry-kind='directory'][data-entry-path]");
  const rowPath = row?.dataset.entryPath;
  if (row && rowPath) {
    return {
      action: "copy",
      path: rowPath,
      label: row.dataset.entryName || basename(rowPath),
      element: row,
      valid: regularDestinationValid(rowPath),
      spring: "open",
    };
  }

  const pane = hit.closest<HTMLElement>(".explorer-pane[data-pane-path]");
  const panePath = pane?.dataset.panePath;
  if (pane && panePath) {
    const area = pane.querySelector<HTMLElement>(".file-area") ?? pane;
    return {
      action: "copy",
      path: panePath,
      label: basename(panePath),
      element: area,
      valid: regularDestinationValid(panePath),
      spring: null,
    };
  }

  const fallback = getActiveDirectory();
  if (!fallback) return null;
  return {
    action: "copy",
    path: fallback,
    label: basename(fallback),
    element: document.querySelector<HTMLElement>(".explorer-pane.active .file-area"),
    valid: regularDestinationValid(fallback),
    spring: null,
  };
}

function scheduleSpring(destination: NativeDestination) {
  if (!destination.valid || !destination.element || !destination.spring) {
    clearSpring();
    return;
  }
  if (springTarget === destination.element) return;

  clearSpring();
  springTarget = destination.element;
  springTarget.classList.add("native-drop-spring");
  springTimer = window.setTimeout(() => {
    springTimer = null;
    const target = springTarget;
    const spring = destination.spring;
    if (!target || !target.isConnected) {
      clearSpring();
      return;
    }
    target.classList.remove("native-drop-spring");
    springTarget = null;
    if (spring === "click") {
      if (!target.classList.contains("active")) target.click();
      return;
    }
    target.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: target.getBoundingClientRect().left + 8,
      clientY: target.getBoundingClientRect().top + 8,
    }));
  }, SPRING_DELAY_MS);
}

function showDestination(destination: NativeDestination | null) {
  clearTarget();
  if (!destination?.element) {
    clearSpring();
    return;
  }

  activeTarget = destination.element;
  activeTarget.classList.add("native-drop-target");
  if (!destination.valid) activeTarget.classList.add("native-drop-invalid");
  else if (destination.action === "trash") activeTarget.classList.add("native-drop-trash");
  else if (destination.action === "portal") activeTarget.classList.add("native-drop-portal");
  else activeTarget.classList.add("native-drop-copy");
  activeTarget.dataset.nativeDropIntent = !destination.valid
    ? "Not available"
    : destination.action === "trash"
      ? "Move to Trash"
      : destination.action === "portal"
        ? "Add to Portal"
        : `Copy to ${destination.label}`;
  scheduleSpring(destination);
}

function addToPortal(paths: string[]) {
  const key = "scout:portal:v1";
  const existing = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
  const set = new Set<string>(Array.isArray(existing) ? existing.filter((item): item is string => typeof item === "string") : []);
  for (const path of paths) set.add(path);
  localStorage.setItem(key, JSON.stringify([...set]));
  window.dispatchEvent(new CustomEvent("scout:portal-updated"));
  document.body.dispatchEvent(new CustomEvent("scout:reconcile-portal"));
}

async function performDrop(paths: string[], destination: NativeDestination) {
  if (!destination.valid) {
    toast("That item cannot be dropped there", true);
    return;
  }

  if (destination.action === "portal") {
    addToPortal(paths);
    toast(`Added ${paths.length === 1 ? "item" : `${paths.length} items`} to Portal`);
    return;
  }

  if (destination.action === "trash") {
    await trashEntries(paths);
    toast(paths.length === 1 ? "Moved item to Trash" : `Moved ${paths.length} items to Trash`);
    window.dispatchEvent(new CustomEvent("scout:ux-files-mutated", { detail: { kind: "trash", paths } }));
    return;
  }

  if (!destination.path) return;
  await copyEntries(paths, destination.path);
  toast(`Copied ${paths.length === 1 ? "1 item" : `${paths.length} items`} to ${destination.label}`);
  window.dispatchEvent(new CustomEvent("scout:ux-files-mutated", {
    detail: { kind: "copy", paths, destination: destination.path },
  }));
}

export async function installNativeFileDrop(): Promise<() => void> {
  try {
    const scaleFactor = await getCurrentWindow().scaleFactor();
    return await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "leave") {
        clearDragState();
        return;
      }

      if (event.payload.type === "enter") draggedPaths = [...event.payload.paths];
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDropActive(true);
        const point = event.payload.position.toLogical(scaleFactor);
        showDestination(resolveDestination(point.x, point.y));
        return;
      }

      const paths = event.payload.paths;
      const point = event.payload.position.toLogical(scaleFactor);
      const destination = resolveDestination(point.x, point.y);
      clearDragState();
      if (!paths.length || !destination) return;

      void performDrop(paths, destination).catch((error) => {
        console.error("Scout could not complete dropped file operation", error);
        toast(error instanceof Error ? error.message : String(error), true);
      });
    });
  } catch {
    return () => {};
  }
}

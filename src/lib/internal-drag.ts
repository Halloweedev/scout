import { copyEntries, moveEntries } from "./fs";

interface DragCandidate {
  startX: number;
  startY: number;
  paths: string[];
  label: string;
}

interface DropDestination {
  path: string;
  label: string;
  element: HTMLElement;
  valid: boolean;
  portal: boolean;
  springRow: HTMLElement | null;
}

const DRAG_THRESHOLD = 6;
const SPRING_DELAY_MS = 720;
const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

let candidate: DragCandidate | null = null;
let dragging = false;
let currentDestination: DropDestination | null = null;
let ghost: HTMLDivElement | null = null;
let suppressClick = false;
let copyMode = false;
let springTimer: number | undefined;
let springPath: string | null = null;
let springRow: HTMLElement | null = null;
const springOpened = new Set<string>();

function rowFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".pane-file-row, .portal-row");
}

function rowPath(row: HTMLElement | null) {
  if (!row) return null;
  return row.dataset.entryPath ?? row.dataset.portalPath ?? null;
}

function selectedPaths(row: HTMLElement) {
  const pane = row.closest<HTMLElement>(".explorer-pane");
  if (!pane) return [] as string[];
  return [...pane.querySelectorAll<HTMLElement>(".pane-file-row.selected")]
    .map((item) => item.dataset.entryPath)
    .filter((path): path is string => !!path);
}

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
}

function parentDirectory(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return normalized;
  if (index === 0) return "/";
  if (index === 2 && /^[a-zA-Z]:/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, index);
}

function pathWithin(root: string, value: string) {
  const a = comparablePath(root);
  const b = comparablePath(value);
  return a === b || b.startsWith(a === "/" ? "/" : `${a}/`);
}

function basename(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function breadcrumbPath(button: HTMLElement) {
  const display = button.closest<HTMLElement>(".path-display.breadcrumbs");
  const panePath = document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? display?.title ?? "";
  if (!display || !panePath) return null;
  const buttons = [...display.querySelectorAll<HTMLElement>(".breadcrumb")];
  const index = buttons.indexOf(button);
  if (index < 0) return null;

  const normalized = panePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (index >= parts.length) return null;
  const drive = /^[a-zA-Z]:/.exec(normalized)?.[0] ?? null;
  const unc = panePath.startsWith("\\\\");
  const unixAbsolute = !drive && !unc && normalized.startsWith("/");

  if (drive) {
    const rest = parts.slice(1, index + 1);
    return rest.length ? `${drive}\\${rest.join("\\")}` : `${drive}\\`;
  }
  if (unc) return `\\\\${parts.slice(0, index + 1).join("\\")}`;
  return `${unixAbsolute ? "/" : ""}${parts.slice(0, index + 1).join("/")}`;
}

function copyModifier(event: PointerEvent) {
  return isMac ? event.altKey : event.ctrlKey;
}

function toast(message: string, error = false) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message, error } }));
}

function removeDestinationClasses(element: HTMLElement | null) {
  element?.classList.remove(
    "internal-drop-target",
    "internal-drop-valid",
    "internal-drop-invalid",
    "internal-drop-copy",
  );
  element?.removeAttribute("data-drop-intent");
}

function clearSpring() {
  if (springTimer !== undefined) window.clearTimeout(springTimer);
  springTimer = undefined;
  springRow?.classList.remove("internal-drop-spring");
  springRow = null;
  springPath = null;
}

function clearDestination() {
  removeDestinationClasses(currentDestination?.element ?? null);
  currentDestination = null;
  clearSpring();
}

function removeGhost() {
  ghost?.remove();
  ghost = null;
}

function endVisualDrag() {
  clearDestination();
  removeGhost();
  document.documentElement.classList.remove("internal-file-drag", "internal-file-drag-copy");
  dragging = false;
  copyMode = false;
  springOpened.clear();
}

function ensureGhost() {
  if (ghost || !candidate) return;
  ghost = document.createElement("div");
  ghost.className = "internal-drag-ghost ux2-drag-ghost";
  ghost.setAttribute("role", "status");
  const action = document.createElement("span");
  action.className = "ux2-drag-action";
  const label = document.createElement("span");
  label.className = "ux2-drag-label";
  ghost.append(action, label);
  document.body.appendChild(ghost);
}

function updateGhostText() {
  if (!candidate || !ghost) return;
  const action = ghost.querySelector<HTMLElement>(".ux2-drag-action");
  const label = ghost.querySelector<HTMLElement>(".ux2-drag-label");
  if (!action || !label) return;

  if (currentDestination?.portal) {
    action.textContent = "Add";
    label.textContent = candidate.paths.length === 1 ? candidate.label : `${candidate.paths.length} items`;
    return;
  }

  action.textContent = copyMode ? "Copy" : "Move";
  const subject = candidate.paths.length === 1 ? candidate.label : `${candidate.paths.length} items`;
  label.textContent = currentDestination
    ? `${subject} → ${currentDestination.label}`
    : subject;
}

function positionGhost(x: number, y: number) {
  ensureGhost();
  updateGhostText();
  if (ghost) ghost.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
}

function destinationIsValid(path: string) {
  if (!candidate) return false;
  if (candidate.paths.some((source) => pathWithin(source, path))) return false;
  if (!copyMode && candidate.paths.every((source) => comparablePath(parentDirectory(source)) === comparablePath(path))) {
    return false;
  }
  return true;
}

function resolveDestination(x: number, y: number): DropDestination | null {
  if (!candidate) return null;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;

  const portalPanel = hit.closest<HTMLElement>(".portal-panel, .portal-body");
  if (portalPanel) {
    return {
      path: "__portal__",
      label: "Portal",
      element: portalPanel,
      valid: true,
      portal: true,
      springRow: null,
    };
  }

  const sidebarTarget = hit.closest<HTMLElement>("[data-scout-drop-path]");
  const sidebarPath = sidebarTarget?.dataset.scoutDropPath;
  if (sidebarTarget && sidebarPath) {
    return {
      path: sidebarPath,
      label: sidebarTarget.dataset.scoutDropLabel || basename(sidebarPath),
      element: sidebarTarget,
      valid: destinationIsValid(sidebarPath),
      portal: false,
      springRow: null,
    };
  }

  const breadcrumb = hit.closest<HTMLElement>(".breadcrumb");
  const breadcrumbDestination = breadcrumb ? breadcrumbPath(breadcrumb) : null;
  if (breadcrumb && breadcrumbDestination) {
    return {
      path: breadcrumbDestination,
      label: breadcrumb.textContent?.trim() || basename(breadcrumbDestination),
      element: breadcrumb,
      valid: destinationIsValid(breadcrumbDestination),
      portal: false,
      springRow: null,
    };
  }

  const targetRow = hit.closest<HTMLElement>(".pane-file-row");
  const targetPath = rowPath(targetRow);
  if (
    targetRow
    && targetPath
    && targetRow.dataset.entryKind === "directory"
    && !candidate.paths.includes(targetPath)
  ) {
    return {
      path: targetPath,
      label: targetRow.dataset.entryName ?? basename(targetPath),
      element: targetRow,
      valid: destinationIsValid(targetPath),
      portal: false,
      springRow: targetRow,
    };
  }

  const pane = hit.closest<HTMLElement>(".explorer-pane");
  if (!pane) return null;
  const path = pane.dataset.panePath;
  const area = pane.querySelector<HTMLElement>(".file-area");
  if (!path || !area) return null;
  return {
    path,
    label: basename(path),
    element: area,
    valid: destinationIsValid(path),
    portal: false,
    springRow: null,
  };
}

function scheduleSpring(destination: DropDestination) {
  if (!destination.valid || !destination.springRow || destination.portal || springOpened.has(destination.path)) return;
  springPath = destination.path;
  springRow = destination.springRow;
  springRow.classList.add("internal-drop-spring");
  springTimer = window.setTimeout(() => {
    springTimer = undefined;
    const row = springRow;
    const path = springPath;
    if (!dragging || !row || !path || currentDestination?.path !== path || !row.isConnected) {
      clearSpring();
      return;
    }
    springOpened.add(path);
    row.classList.remove("internal-drop-spring");
    springRow = null;
    springPath = null;
    row.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: row.getBoundingClientRect().left + 8,
      clientY: row.getBoundingClientRect().top + 8,
    }));
  }, SPRING_DELAY_MS);
}

function applyDestination(next: DropDestination | null) {
  const previous = currentDestination;
  const sameSpringTarget = previous?.path === next?.path && previous?.springRow === next?.springRow;

  removeDestinationClasses(previous?.element ?? null);
  currentDestination = next;

  if (!sameSpringTarget) clearSpring();
  if (!next) {
    updateGhostText();
    return;
  }

  next.element.classList.add("internal-drop-target", next.valid ? "internal-drop-valid" : "internal-drop-invalid");
  if (copyMode && !next.portal && next.valid) next.element.classList.add("internal-drop-copy");
  next.element.dataset.dropIntent = next.portal ? "Add to Portal" : next.valid
    ? `${copyMode ? "Copy" : "Move"} to ${next.label}`
    : "Not available";

  if (!sameSpringTarget) scheduleSpring(next);
  updateGhostText();
}

function updateDestination(event: PointerEvent) {
  if (!candidate) return;
  const nextCopyMode = copyModifier(event);
  if (nextCopyMode !== copyMode) {
    copyMode = nextCopyMode;
    document.documentElement.classList.toggle("internal-file-drag-copy", copyMode);
  }
  applyDestination(resolveDestination(event.clientX, event.clientY));
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest("input, button, .tab-close, .rename-input")) {
    if (!event.target.closest(".portal-row")) return;
  }

  const row = rowFromTarget(event.target);
  const path = rowPath(row);
  if (!row || !path) return;

  row.style.userSelect = "none";
  const paths = row.classList.contains("portal-row")
    ? [path]
    : (() => {
      const selected = selectedPaths(row);
      return selected.includes(path) ? selected : [path];
    })();

  candidate = {
    startX: event.clientX,
    startY: event.clientY,
    paths,
    label: row.dataset.entryName ?? row.dataset.portalPath ?? basename(path),
  };
}

function handlePointerMove(event: PointerEvent) {
  if (!candidate) return;

  if (!dragging) {
    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (distance < DRAG_THRESHOLD) return;
    dragging = true;
    copyMode = copyModifier(event);
    document.documentElement.classList.add("internal-file-drag");
    document.documentElement.classList.toggle("internal-file-drag-copy", copyMode);
  }

  event.preventDefault();
  positionGhost(event.clientX, event.clientY);
  updateDestination(event);
}

async function performDrop(paths: string[], target: DropDestination, shouldCopy: boolean) {
  if (target.portal) {
    try {
      const key = "scout:portal:v1";
      const existing = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
      const set = new Set<string>(Array.isArray(existing) ? existing.filter((item): item is string => typeof item === "string") : []);
      for (const path of paths) set.add(path);
      localStorage.setItem(key, JSON.stringify([...set]));
      window.dispatchEvent(new CustomEvent("scout:portal-updated"));
      document.body.dispatchEvent(new CustomEvent("scout:reconcile-portal"));
      toast(`Added ${paths.length === 1 ? "item" : `${paths.length} items`} to Portal`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
    return;
  }

  try {
    if (shouldCopy) await copyEntries(paths, target.path);
    else await moveEntries(paths, target.path);
    const count = paths.length === 1 ? "1 item" : `${paths.length} items`;
    toast(`${shouldCopy ? "Copied" : "Moved"} ${count} to ${target.label}`);
    window.dispatchEvent(new CustomEvent("scout:ux-files-mutated", {
      detail: { kind: shouldCopy ? "copy" : "move", paths, destination: target.path },
    }));
  } catch (error) {
    console.error("Scout could not complete dragged file operation", error);
    toast(error instanceof Error ? error.message : String(error), true);
  }
}

function handlePointerUp() {
  if (!candidate) return;
  const paths = candidate.paths;
  const target = currentDestination;
  const completedDrag = dragging;
  const shouldCopy = copyMode;

  document.querySelectorAll<HTMLElement>(".pane-file-row, .portal-row").forEach((row) => {
    row.style.userSelect = "";
  });
  candidate = null;
  endVisualDrag();

  if (!completedDrag) return;
  suppressClick = true;
  window.setTimeout(() => { suppressClick = false; }, 100);

  if (!target || !target.valid) {
    if (target && !target.valid) toast("That item cannot be dropped there", true);
    return;
  }
  void performDrop(paths, target, shouldCopy);
}

function handlePointerCancel() {
  candidate = null;
  endVisualDrag();
}

function handleClickCapture(event: MouseEvent) {
  if (!suppressClick || !rowFromTarget(event.target)) return;
  suppressClick = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleBrowserDragStart(event: DragEvent) {
  if (rowFromTarget(event.target)) event.preventDefault();
}

export function installInternalPointerDrag() {
  document.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerCancel);
  document.addEventListener("click", handleClickCapture, true);
  document.addEventListener("dragstart", handleBrowserDragStart, true);

  return () => {
    document.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
    document.removeEventListener("click", handleClickCapture, true);
    document.removeEventListener("dragstart", handleBrowserDragStart, true);
    candidate = null;
    endVisualDrag();
  };
}

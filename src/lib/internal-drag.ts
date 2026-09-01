import { getActiveDirectory, getActiveListing, moveEntries } from "./fs";

interface DragCandidate {
  startX: number;
  startY: number;
  paths: string[];
  label: string;
}

const DRAG_THRESHOLD = 6;
let candidate: DragCandidate | null = null;
let dragging = false;
let destination: string | null = null;
let dropTarget: HTMLElement | null = null;
let ghost: HTMLDivElement | null = null;
let suppressClick = false;

function rowFromTarget(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(".file-row") : null;
}

function entryForRow(row: HTMLElement | null) {
  if (!row) return null;
  const listing = getActiveListing();
  const index = Number(row.dataset.entryIndex);
  if (!listing || !Number.isInteger(index)) return null;
  return listing.entries[index] ?? null;
}

function selectedPaths() {
  const listing = getActiveListing();
  if (!listing) return [];
  const paths: string[] = [];
  for (const row of document.querySelectorAll<HTMLElement>(".file-row.selected")) {
    const index = Number(row.dataset.entryIndex);
    const entry = Number.isInteger(index) ? listing.entries[index] : undefined;
    if (entry) paths.push(entry.path);
  }
  return paths;
}

function clearDropTarget() {
  dropTarget?.classList.remove("internal-drop-target");
  dropTarget = null;
  destination = null;
}

function removeGhost() {
  ghost?.remove();
  ghost = null;
}

function endVisualDrag() {
  clearDropTarget();
  removeGhost();
  document.documentElement.classList.remove("internal-file-drag");
  dragging = false;
}

function ensureGhost() {
  if (ghost || !candidate) return;
  ghost = document.createElement("div");
  ghost.className = "internal-drag-ghost";
  ghost.textContent = candidate.paths.length === 1 ? candidate.label : `${candidate.paths.length} items`;
  document.body.appendChild(ghost);
}

function positionGhost(x: number, y: number) {
  ensureGhost();
  if (ghost) ghost.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
}

function updateDestination(x: number, y: number) {
  if (!candidate) return;
  clearDropTarget();

  const listing = getActiveListing();
  const activeDirectory = getActiveDirectory();
  if (!listing || !activeDirectory) return;

  const hit = document.elementFromPoint(x, y);
  const targetRow = hit?.closest<HTMLElement>(".file-row") ?? null;
  const targetEntry = entryForRow(targetRow);

  if (targetRow && targetEntry?.kind === "directory" && !candidate.paths.includes(targetEntry.path)) {
    destination = targetEntry.path;
    dropTarget = targetRow;
  } else {
    destination = activeDirectory;
    dropTarget = document.querySelector<HTMLElement>(".file-area");
  }

  dropTarget?.classList.add("internal-drop-target");
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest("input, button, .tab-close")) return;

  const row = rowFromTarget(event.target);
  const entry = entryForRow(row);
  if (!row || !entry) return;

  const selected = selectedPaths();
  const paths = selected.includes(entry.path) ? selected : [entry.path];
  candidate = {
    startX: event.clientX,
    startY: event.clientY,
    paths,
    label: entry.name,
  };
}

function handlePointerMove(event: PointerEvent) {
  if (!candidate) return;

  if (!dragging) {
    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (distance < DRAG_THRESHOLD) return;
    dragging = true;
    document.documentElement.classList.add("internal-file-drag");
  }

  event.preventDefault();
  positionGhost(event.clientX, event.clientY);
  updateDestination(event.clientX, event.clientY);
}

function handlePointerUp() {
  if (!candidate) return;
  const paths = candidate.paths;
  const target = destination;
  const completedDrag = dragging;

  candidate = null;
  endVisualDrag();

  if (!completedDrag) return;
  suppressClick = true;
  window.setTimeout(() => {
    suppressClick = false;
  }, 80);

  if (!target) return;
  void moveEntries(paths, target).catch((error) => {
    console.error("Scout could not move dragged files", error);
  });
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

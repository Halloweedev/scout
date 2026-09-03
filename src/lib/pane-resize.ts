const STORAGE_KEY = "scout.panes.split.v1";
const MIN_RATIO = 0.22;
const MAX_RATIO = 0.78;

type Axis = "column" | "row";

interface SplitState {
  column: number;
  row: number;
}

let observer: MutationObserver | null = null;
let handles: HTMLElement[] = [];
let activeAxis: Axis | null = null;
let activeGrid: HTMLElement | null = null;

function clamp(value: number) {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, value));
}

function readState(): SplitState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SplitState> | null;
    return {
      column: clamp(typeof parsed?.column === "number" ? parsed.column : 0.5),
      row: clamp(typeof parsed?.row === "number" ? parsed.row : 0.5),
    };
  } catch {
    return { column: 0.5, row: 0.5 };
  }
}

function writeState(state: SplitState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyState(grid: HTMLElement, state = readState()) {
  grid.style.setProperty("--scout-pane-column", `${state.column * 100}%`);
  grid.style.setProperty("--scout-pane-row", `${state.row * 100}%`);
  for (const handle of handles) {
    if (handle.dataset.axis === "column") handle.setAttribute("aria-valuenow", String(Math.round(state.column * 100)));
    if (handle.dataset.axis === "row") handle.setAttribute("aria-valuenow", String(Math.round(state.row * 100)));
  }
}

function paneCount(grid: HTMLElement) {
  return grid.querySelectorAll(":scope > .explorer-pane").length;
}

function clearHandles() {
  for (const handle of handles) handle.remove();
  handles = [];
}

function makeHandle(grid: HTMLElement, axis: Axis, rightOnly = false) {
  const handle = document.createElement("div");
  handle.className = `pane-resize-handle ${axis}${rightOnly ? " right-only" : ""}`;
  handle.dataset.axis = axis;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", axis === "column" ? "vertical" : "horizontal");
  handle.setAttribute("aria-label", axis === "column" ? "Resize pane columns" : "Resize pane rows");
  handle.setAttribute("aria-valuemin", String(Math.round(MIN_RATIO * 100)));
  handle.setAttribute("aria-valuemax", String(Math.round(MAX_RATIO * 100)));
  handle.tabIndex = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activeAxis = axis;
    activeGrid = grid;
    handle.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add(axis === "column" ? "pane-resizing-columns" : "pane-resizing-rows");
  });
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    const state = readState();
    state[axis] = 0.5;
    writeState(state);
    applyState(grid, state);
  });
  handle.addEventListener("keydown", (event) => {
    const negative = axis === "column" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const positive = axis === "column" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!negative && !positive && event.key !== "Home") return;
    event.preventDefault();
    const state = readState();
    state[axis] = event.key === "Home" ? 0.5 : clamp(state[axis] + (positive ? 0.04 : -0.04));
    writeState(state);
    applyState(grid, state);
  });

  grid.append(handle);
  handles.push(handle);
  return handle;
}

function reconcile() {
  const grid = document.querySelector<HTMLElement>(".pane-grid");
  if (!grid) {
    clearHandles();
    return;
  }
  const count = paneCount(grid);
  const desired = count <= 1 ? 0 : count === 2 ? 1 : 2;
  if (handles.length !== desired || handles.some((handle) => handle.parentElement !== grid)) {
    clearHandles();
    if (count >= 2) makeHandle(grid, "column");
    if (count >= 3) makeHandle(grid, "row", count === 3);
  } else {
    const row = handles.find((handle) => handle.dataset.axis === "row");
    row?.classList.toggle("right-only", count === 3);
  }
  applyState(grid);
}

function endResize() {
  if (!activeAxis) return;
  activeAxis = null;
  activeGrid = null;
  document.documentElement.classList.remove("pane-resizing-columns", "pane-resizing-rows");
}

function handlePointerMove(event: PointerEvent) {
  const axis = activeAxis;
  const grid = activeGrid;
  if (!axis || !grid) return;
  const rect = grid.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  event.preventDefault();
  const state = readState();
  state[axis] = clamp(axis === "column"
    ? (event.clientX - rect.left) / rect.width
    : (event.clientY - rect.top) / rect.height);
  writeState(state);
  applyState(grid, state);
}

export function installPaneResize() {
  observer = new MutationObserver(() => queueMicrotask(reconcile));
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", endResize);
  window.addEventListener("pointercancel", endResize);
  reconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
    endResize();
    clearHandles();
    document.querySelector<HTMLElement>(".pane-grid")?.style.removeProperty("--scout-pane-column");
    document.querySelector<HTMLElement>(".pane-grid")?.style.removeProperty("--scout-pane-row");
  };
}

const STORAGE_KEY = "scout.list-columns.v1";
const COLUMN_NAMES = ["name", "modified", "size"] as const;
type ColumnName = (typeof COLUMN_NAMES)[number];
type Widths = Record<ColumnName, number>;

const LIMITS: Record<ColumnName, { min: number; max: number }> = {
  name: { min: 160, max: 900 },
  modified: { min: 110, max: 360 },
  size: { min: 72, max: 220 },
};

let observer: MutationObserver | null = null;
let reconcileQueued = false;

function clamp(column: ColumnName, value: number) {
  const { min, max } = LIMITS[column];
  return Math.max(min, Math.min(max, Math.round(value)));
}

function readWidths(): Widths | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Widths> | null;
    if (!parsed) return null;
    const widths = {} as Widths;
    for (const column of COLUMN_NAMES) {
      const value = parsed[column];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      widths[column] = clamp(column, value);
    }
    return widths;
  } catch {
    return null;
  }
}

function writeWidths(widths: Widths) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
}

function areaFor(header: HTMLElement) {
  return header.closest<HTMLElement>(".file-area");
}

function applyWidths(area: HTMLElement, widths: Widths) {
  area.classList.add("scout-list-columns-fixed");
  area.style.setProperty("--scout-list-name-width", `${widths.name}px`);
  area.style.setProperty("--scout-list-modified-width", `${widths.modified}px`);
  area.style.setProperty("--scout-list-size-width", `${widths.size}px`);
}

function clearWidths(area: HTMLElement) {
  area.classList.remove("scout-list-columns-fixed");
  area.style.removeProperty("--scout-list-name-width");
  area.style.removeProperty("--scout-list-modified-width");
  area.style.removeProperty("--scout-list-size-width");
}

function measuredWidths(header: HTMLElement): Widths {
  const cells = [...header.children].filter((node): node is HTMLElement => node instanceof HTMLElement).slice(0, 3);
  return {
    name: clamp("name", cells[0]?.getBoundingClientRect().width ?? 320),
    modified: clamp("modified", cells[1]?.getBoundingClientRect().width ?? 150),
    size: clamp("size", cells[2]?.getBoundingClientRect().width ?? 86),
  };
}

function currentWidths(header: HTMLElement): Widths {
  const area = areaFor(header);
  if (!area) return measuredWidths(header);
  const saved = readWidths();
  if (saved) return saved;
  return measuredWidths(header);
}

function syncAllAreas(widths: Widths | null) {
  for (const area of document.querySelectorAll<HTMLElement>(".file-area")) {
    const header = area.querySelector<HTMLElement>(":scope > .file-header, .file-header");
    if (!header) {
      clearWidths(area);
      area.classList.remove("scout-list-columns-enabled");
      continue;
    }
    area.classList.add("scout-list-columns-enabled");
    if (widths) applyWidths(area, widths);
    else clearWidths(area);
  }
}

function persistColumn(header: HTMLElement, column: ColumnName, width: number) {
  const widths = currentWidths(header);
  widths[column] = clamp(column, width);
  writeWidths(widths);
  syncAllAreas(widths);
  return widths;
}

function resetColumns() {
  localStorage.removeItem(STORAGE_KEY);
  syncAllAreas(null);
}

function makeHandle(header: HTMLElement, cell: HTMLElement, column: ColumnName) {
  const handle = document.createElement("span");
  handle.className = "scout-list-column-resizer";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", `Resize ${column === "modified" ? "Modified" : column === "size" ? "Size" : "Name"} column`);
  handle.dataset.scoutListColumn = column;
  handle.title = "Drag to resize · Double-click to reset columns";

  let pointerId: number | null = null;
  let startX = 0;
  let startWidth = 0;

  const finish = () => {
    if (pointerId === null) return;
    pointerId = null;
    document.body.classList.remove("scout-list-column-resizing");
    handle.removeAttribute("aria-grabbed");
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const area = areaFor(header);
    if (!area) return;
    const widths = currentWidths(header);
    applyWidths(area, widths);
    syncAllAreas(widths);
    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = widths[column];
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute("aria-grabbed", "true");
    document.body.classList.add("scout-list-column-resizing");
  });

  handle.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    event.preventDefault();
    persistColumn(header, column, startWidth + event.clientX - startX);
  });

  handle.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId) return;
    event.preventDefault();
    finish();
  });

  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetColumns();
  });

  handle.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      handle.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      resetColumns();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 24 : 8;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const widths = currentWidths(header);
    persistColumn(header, column, widths[column] + direction * step);
  });

  cell.append(handle);
}

function enhanceHeader(header: HTMLElement) {
  if (header.dataset.scoutListColumns === "1") return;
  const area = areaFor(header);
  if (!area) return;
  const cells = [...header.children].filter((node): node is HTMLElement => node instanceof HTMLElement).slice(0, 3);
  if (cells.length < 3) return;

  header.dataset.scoutListColumns = "1";
  area.classList.add("scout-list-columns-enabled");
  const saved = readWidths();
  if (saved) applyWidths(area, saved);

  COLUMN_NAMES.forEach((column, index) => {
    const cell = cells[index];
    if (!cell) return;
    cell.classList.add("scout-list-column-header");
    makeHandle(header, cell, column);
  });
}

function reconcile() {
  reconcileQueued = false;
  const headers = [...document.querySelectorAll<HTMLElement>(".explorer-pane .file-header")];
  for (const header of headers) enhanceHeader(header);

  for (const area of document.querySelectorAll<HTMLElement>(".file-area.scout-list-columns-enabled")) {
    if (!area.querySelector(".file-header")) {
      area.classList.remove("scout-list-columns-enabled");
      clearWidths(area);
    }
  }

  const saved = readWidths();
  if (saved) syncAllAreas(saved);
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

export function installListColumnResize() {
  reconcile();
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    document.body.classList.remove("scout-list-column-resizing");
    for (const area of document.querySelectorAll<HTMLElement>(".file-area.scout-list-columns-enabled")) {
      area.classList.remove("scout-list-columns-enabled");
      clearWidths(area);
    }
    document.querySelectorAll(".scout-list-column-resizer").forEach((node) => node.remove());
    document.querySelectorAll<HTMLElement>(".file-header[data-scout-list-columns]").forEach((header) => {
      delete header.dataset.scoutListColumns;
      header.querySelectorAll(".scout-list-column-header").forEach((cell) => cell.classList.remove("scout-list-column-header"));
    });
  };
}

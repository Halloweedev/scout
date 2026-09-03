type SidebarOrderKind = "bookmarks" | "workspaces";

interface SidebarOrderState {
  bookmarks: string[];
  workspaces: string[];
}

interface BookmarkRecord {
  id: string;
  path: string;
  label?: string;
}

interface WorkspaceRecord {
  id: string;
  name?: string;
  panePaths?: string[];
}

const ORDER_KEY = "scout.sidebar-order.v1";
const BOOKMARKS_KEY = "scout.bookmarks.v1";
const WORKSPACES_KEY = "scout.workspaces.v1";
const DRAG_THRESHOLD = 5;

let observer: MutationObserver | null = null;
let reconcileQueued = false;
let suppressClickUntil = 0;

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function readOrder(): SidebarOrderState {
  const value = readJson<Partial<SidebarOrderState>>(ORDER_KEY, {});
  return {
    bookmarks: Array.isArray(value.bookmarks) ? value.bookmarks.filter((id): id is string => typeof id === "string") : [],
    workspaces: Array.isArray(value.workspaces) ? value.workspaces.filter((id): id is string => typeof id === "string") : [],
  };
}

function writeOrder(state: SidebarOrderState) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(state));
}

function records(kind: SidebarOrderKind) {
  if (kind === "bookmarks") {
    return readJson<BookmarkRecord[]>(BOOKMARKS_KEY, []).filter((item) => typeof item?.id === "string" && !!item.id);
  }
  return readJson<WorkspaceRecord[]>(WORKSPACES_KEY, []).filter((item) => typeof item?.id === "string" && !!item.id);
}

function kindForRow(row: HTMLElement): SidebarOrderKind | null {
  if (row.closest(".bookmark-list")) return "bookmarks";
  if (row.closest(".workspace-list")) return "workspaces";
  return null;
}

function rowsFor(kind: SidebarOrderKind) {
  const selector = kind === "bookmarks"
    ? ".sidebar .bookmark-list > .workspace-row"
    : ".sidebar .workspace-list:not(.bookmark-list) > .workspace-row";
  return [...document.querySelectorAll<HTMLElement>(selector)].filter((row) => row.offsetParent !== null || !row.closest("[hidden]"));
}

function containerFor(kind: SidebarOrderKind) {
  const selector = kind === "bookmarks"
    ? ".sidebar .bookmark-list"
    : ".sidebar .workspace-list:not(.bookmark-list)";
  return document.querySelector<HTMLElement>(selector);
}

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

function bookmarkIdForRow(row: HTMLElement, unused: BookmarkRecord[]) {
  const path = row.querySelector<HTMLElement>(".workspace-open")?.getAttribute("title") ?? "";
  const exact = unused.find((item) => comparablePath(item.path) === comparablePath(path));
  return exact?.id ?? unused[0]?.id ?? null;
}

function workspaceIdForRow(row: HTMLElement, unused: WorkspaceRecord[]) {
  const button = row.querySelector<HTMLElement>(".workspace-open");
  const paths = (button?.getAttribute("title") ?? "").split("\n").filter(Boolean);
  const name = button?.querySelector<HTMLElement>("span:not(.workspace-count)")?.textContent?.trim() ?? "";
  const exact = unused.find((item) => {
    if ((item.name ?? "") !== name) return false;
    const candidate = item.panePaths ?? [];
    return candidate.length === paths.length && candidate.every((path, index) => path === paths[index]);
  });
  return exact?.id ?? unused[0]?.id ?? null;
}

function assignStableIds(kind: SidebarOrderKind) {
  const available = records(kind);
  const used = new Set(rowsFor(kind).map((row) => row.dataset.scoutSidebarOrderId).filter((id): id is string => !!id));
  const unused = available.filter((item) => !used.has(item.id));

  for (const row of rowsFor(kind)) {
    if (row.dataset.scoutSidebarOrderId) continue;
    const id = kind === "bookmarks"
      ? bookmarkIdForRow(row, unused as BookmarkRecord[])
      : workspaceIdForRow(row, unused as WorkspaceRecord[]);
    if (!id) continue;
    row.dataset.scoutSidebarOrderId = id;
    row.dataset.scoutSidebarOrderKind = kind;
    row.classList.add("scout-sidebar-order-row");
    row.setAttribute("aria-roledescription", "reorderable item");
    row.title = "Drag to reorder · Alt+↑/↓";
    const index = unused.findIndex((item) => item.id === id);
    if (index >= 0) unused.splice(index, 1);
  }
}

function normalizedIds(kind: SidebarOrderKind, existing: string[]) {
  const dataIds = records(kind).map((item) => item.id);
  const valid = existing.filter((id) => dataIds.includes(id));
  const missing = dataIds.filter((id) => !valid.includes(id));
  // New workspaces are created at the top by App; bookmarks are appended.
  return kind === "workspaces" ? [...missing, ...valid] : [...valid, ...missing];
}

function applyOrder(kind: SidebarOrderKind, persistNormalization = true) {
  assignStableIds(kind);
  const container = containerFor(kind);
  if (!container) return;

  const state = readOrder();
  const orderedIds = normalizedIds(kind, state[kind]);
  const byId = new Map(rowsFor(kind).map((row) => [row.dataset.scoutSidebarOrderId ?? "", row]));
  const currentIds = rowsFor(kind).map((row) => row.dataset.scoutSidebarOrderId ?? "");

  if (currentIds.join("\u0000") !== orderedIds.join("\u0000")) {
    for (const id of orderedIds) {
      const row = byId.get(id);
      if (row) container.append(row);
    }
  }

  if (persistNormalization && state[kind].join("\u0000") !== orderedIds.join("\u0000")) {
    state[kind] = orderedIds;
    writeOrder(state);
  }
}

function reconcile() {
  reconcileQueued = false;
  applyOrder("bookmarks");
  applyOrder("workspaces");
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function persistMove(kind: SidebarOrderKind, draggedId: string, targetId: string | null, after: boolean) {
  const state = readOrder();
  const ordered = normalizedIds(kind, state[kind]).filter((id) => id !== draggedId);
  let index = targetId ? ordered.indexOf(targetId) : -1;
  if (index < 0) index = ordered.length;
  else if (after) index += 1;
  ordered.splice(index, 0, draggedId);
  state[kind] = ordered;
  writeOrder(state);
  applyOrder(kind, false);
}

function clearDropHints() {
  document.querySelectorAll<HTMLElement>(".scout-sidebar-order-before, .scout-sidebar-order-after")
    .forEach((row) => row.classList.remove("scout-sidebar-order-before", "scout-sidebar-order-after"));
}

function toast(message: string) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message } }));
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(".workspace-delete, .sidebar-section-action")) return;
  const row = target.closest<HTMLElement>(".scout-sidebar-order-row");
  if (!row) return;
  const kind = kindForRow(row);
  const draggedId = row.dataset.scoutSidebarOrderId;
  if (!kind || !draggedId || rowsFor(kind).length < 2) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let hoverRow: HTMLElement | null = null;
  let hoverAfter = false;

  const pointerMove = (move: PointerEvent) => {
    if (move.pointerId !== event.pointerId) return;
    if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      row.classList.add("scout-sidebar-order-dragging");
      document.body.classList.add("scout-sidebar-order-active");
    }
    move.preventDefault();
    clearDropHints();

    const hit = document.elementFromPoint(move.clientX, move.clientY);
    const candidate = hit instanceof Element ? hit.closest<HTMLElement>(".scout-sidebar-order-row") : null;
    if (!candidate || candidate === row || kindForRow(candidate) !== kind) {
      hoverRow = null;
    } else {
      hoverRow = candidate;
      const rect = candidate.getBoundingClientRect();
      hoverAfter = move.clientY >= rect.top + rect.height / 2;
      candidate.classList.add(hoverAfter ? "scout-sidebar-order-after" : "scout-sidebar-order-before");
    }

    const sidebar = row.closest<HTMLElement>(".sidebar");
    if (sidebar) {
      const rect = sidebar.getBoundingClientRect();
      if (move.clientY < rect.top + 36) sidebar.scrollBy({ top: -18, behavior: "auto" });
      else if (move.clientY > rect.bottom - 36) sidebar.scrollBy({ top: 18, behavior: "auto" });
    }
  };

  const finish = (up: PointerEvent) => {
    if (up.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", pointerMove, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    row.classList.remove("scout-sidebar-order-dragging");
    document.body.classList.remove("scout-sidebar-order-active");
    clearDropHints();
    if (!dragging) return;
    suppressClickUntil = performance.now() + 250;
    persistMove(kind, draggedId, hoverRow?.dataset.scoutSidebarOrderId ?? null, hoverAfter);
    const label = row.querySelector<HTMLElement>(".workspace-open")?.textContent?.trim() || (kind === "bookmarks" ? "Bookmark" : "Workspace");
    toast(`Reordered ${label}`);
  };

  window.addEventListener("pointermove", pointerMove, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
}

function handleClick(event: MouseEvent) {
  if (performance.now() > suppressClickUntil) return;
  if (!(event.target instanceof Element) || !event.target.closest(".scout-sidebar-order-row")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  suppressClickUntil = 0;
}

function handleKeyDown(event: KeyboardEvent) {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest<HTMLElement>(".scout-sidebar-order-row");
  if (!row) return;
  const kind = kindForRow(row);
  const id = row.dataset.scoutSidebarOrderId;
  if (!kind || !id) return;
  const ordered = normalizedIds(kind, readOrder()[kind]);
  const index = ordered.indexOf(id);
  const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const targetId = ordered[nextIndex];
  persistMove(kind, id, targetId, event.key === "ArrowDown");
  queueMicrotask(() => {
    const moved = rowsFor(kind).find((candidate) => candidate.dataset.scoutSidebarOrderId === id);
    moved?.querySelector<HTMLElement>(".workspace-open")?.focus({ preventScroll: true });
    moved?.scrollIntoView({ block: "nearest" });
  });
}

export function installSidebarOrder() {
  reconcile();
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("click", handleClick, true);
  window.addEventListener("keydown", handleKeyDown, true);

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("click", handleClick, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    document.body.classList.remove("scout-sidebar-order-active");
    clearDropHints();
    document.querySelectorAll<HTMLElement>(".scout-sidebar-order-row").forEach((row) => {
      row.classList.remove("scout-sidebar-order-row", "scout-sidebar-order-dragging");
      row.removeAttribute("aria-roledescription");
      row.removeAttribute("title");
      delete row.dataset.scoutSidebarOrderId;
      delete row.dataset.scoutSidebarOrderKind;
    });
  };
}

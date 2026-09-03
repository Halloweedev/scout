const STORAGE_KEY = "scout.sidebar.width.v1";
const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 176;
const MAX_WIDTH = 360;

let observer: MutationObserver | null = null;
let handle: HTMLDivElement | null = null;
let dragging = false;

function clampWidth(value: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
}

function savedWidth() {
  const value = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH ? value : DEFAULT_WIDTH;
}

function setWidth(value: number, persist = true) {
  const width = clampWidth(value);
  document.documentElement.style.setProperty("--scout-sidebar-width", `${width}px`);
  handle?.setAttribute("aria-valuenow", String(width));
  if (persist) localStorage.setItem(STORAGE_KEY, String(width));
}

function endResize() {
  if (!dragging) return;
  dragging = false;
  document.documentElement.classList.remove("sidebar-resizing");
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging) return;
  event.preventDefault();
  setWidth(event.clientX);
}

function ensureHandle() {
  const shell = document.querySelector<HTMLElement>(".app-shell");
  if (!shell) return;
  if (handle?.isConnected) return;

  handle = document.createElement("div");
  handle.className = "sidebar-resize-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize sidebar");
  handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
  handle.setAttribute("aria-valuemax", String(MAX_WIDTH));
  handle.setAttribute("aria-valuenow", String(savedWidth()));
  handle.tabIndex = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    document.documentElement.classList.add("sidebar-resizing");
    handle?.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    setWidth(DEFAULT_WIDTH);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return;
    event.preventDefault();
    const current = Number(handle?.getAttribute("aria-valuenow")) || DEFAULT_WIDTH;
    if (event.key === "Home") setWidth(DEFAULT_WIDTH);
    else setWidth(current + (event.key === "ArrowRight" ? 8 : -8));
  });

  shell.append(handle);
}

export function installSidebarResize() {
  setWidth(savedWidth(), false);
  ensureHandle();
  observer = new MutationObserver(() => queueMicrotask(ensureHandle));
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", endResize);
  window.addEventListener("pointercancel", endResize);

  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
    endResize();
    handle?.remove();
    handle = null;
    document.documentElement.style.removeProperty("--scout-sidebar-width");
  };
}

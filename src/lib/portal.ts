import { copyEntries, moveEntries, openEntry } from "./fs";

const STORAGE_KEY = "scout:portal:v1";
let observer: MutationObserver | null = null;
let panel: HTMLDivElement | null = null;
let sidebarButton: HTMLButtonElement | null = null;
let paths: string[] = [];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function loadPaths() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    paths = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    paths = [];
  }
}

function savePaths() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  updateBadge();
  if (panel) renderPanel();
}

function activeDirectory() {
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function selectedPaths() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row.selected")]
    .map((row) => row.dataset.entryPath)
    .filter((path): path is string => !!path);
}

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function updateBadge() {
  if (!sidebarButton) return;
  const badge = sidebarButton.querySelector<HTMLElement>(".portal-sidebar-count");
  if (badge) badge.textContent = paths.length ? String(paths.length) : "";
  sidebarButton.classList.toggle("has-items", paths.length > 0);
}

function addSelection() {
  const next = selectedPaths();
  if (!next.length) return;
  const seen = new Set(paths);
  for (const path of next) {
    if (!seen.has(path)) {
      paths.push(path);
      seen.add(path);
    }
  }
  savePaths();
}

function removePath(path: string) {
  paths = paths.filter((candidate) => candidate !== path);
  savePaths();
}

function closePanel() {
  panel?.remove();
  panel = null;
  sidebarButton?.classList.remove("active");
}

async function transfer(mode: "copy" | "move") {
  const destination = activeDirectory();
  if (!destination || !paths.length) return;
  const payload = [...paths];
  try {
    if (mode === "copy") await copyEntries(payload, destination);
    else {
      await moveEntries(payload, destination);
      paths = [];
      savePaths();
    }
  } catch (error) {
    const status = panel?.querySelector<HTMLElement>(".portal-status");
    if (status) status.textContent = String(error);
  }
}

function renderPanel() {
  if (!panel) return;
  const body = panel.querySelector<HTMLElement>(".portal-body");
  const count = panel.querySelector<HTMLElement>(".portal-count");
  if (!body || !count) return;
  count.textContent = `${paths.length} ${paths.length === 1 ? "item" : "items"}`;
  body.replaceChildren();

  if (!paths.length) {
    const empty = element("div", "portal-empty");
    empty.textContent = "Collect files here from any folder, then copy or move them into the focused pane.";
    body.append(empty);
    return;
  }

  for (const path of paths) {
    const row = element("div", "portal-row");
    row.draggable = true;
    (row as HTMLElement & { dataset: DOMStringMap }).dataset.portalPath = path;
    row.addEventListener("dragstart", (e) => {
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        dt.setData("text/plain", path);
        dt.effectAllowed = "copyMove";
      }
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    const open = element("button", "portal-open");
    open.type = "button";
    const glyph = element("span", "portal-glyph");
    const text = element("span", "portal-row-text");
    const name = element("span", "portal-name");
    name.textContent = baseName(path);
    const location = element("span", "portal-path");
    location.textContent = path;
    location.title = path;
    text.append(name, location);
    open.append(glyph, text);
    open.addEventListener("click", () => void openEntry(path));
    const remove = element("button", "portal-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${baseName(path)} from Portal`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removePath(path));
    row.append(open, remove);
    body.append(row);
  }
}

function openPanel() {
  if (panel) {
    closePanel();
    return;
  }
  panel = element("div", "portal-panel");
  const header = element("header", "portal-header");
  const heading = element("div", "portal-heading");
  const title = element("div", "portal-title");
  title.textContent = "Portal";
  const count = element("div", "portal-count");
  heading.append(title, count);
  const close = element("button", "portal-close");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", closePanel);
  header.append(heading, close);
  const body = element("div", "portal-body");
  const footer = element("footer", "portal-footer");
  const status = element("span", "portal-status");
  const clear = element("button", "portal-secondary");
  clear.type = "button";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    paths = [];
    savePaths();
  });
  const copy = element("button", "portal-secondary");
  copy.type = "button";
  copy.textContent = "Copy here";
  copy.addEventListener("click", () => void transfer("copy"));
  const move = element("button", "portal-primary");
  move.type = "button";
  move.textContent = "Move here";
  move.addEventListener("click", () => void transfer("move"));
  const actions = element("span", "portal-actions");
  actions.append(clear, copy, move);
  footer.append(status, actions);
  panel.append(header, body, footer);
  document.body.append(panel);
  sidebarButton?.classList.add("active");
  renderPanel();
}

function installSidebarButton() {
  if (sidebarButton?.isConnected) return;
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const spacer = sidebar?.querySelector<HTMLElement>(".sidebar-spacer");
  if (!sidebar || !spacer) return;
  sidebarButton = element("button", "sidebar-item portal-sidebar-button");
  sidebarButton.type = "button";
  const glyph = element("span", "portal-sidebar-glyph");
  const label = element("span");
  label.textContent = "Portal";
  const count = element("span", "portal-sidebar-count");
  sidebarButton.append(glyph, label, count);
  sidebarButton.addEventListener("click", openPanel);
  sidebar.insertBefore(sidebarButton, spacer);
  updateBadge();
}

function enhanceMenu(menu: HTMLElement) {
  if (menu.dataset.portalEnhanced === "1") return;
  menu.dataset.portalEnhanced = "1";
  if (!selectedPaths().length) return;
  const separator = element("div", "menu-separator portal-menu-separator");
  const button = element("button");
  button.type = "button";
  button.textContent = "Add to Portal";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    addSelection();
    menu.remove();
  });
  menu.append(separator, button);
}

function reconcile() {
  installSidebarButton();
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceMenu(menu);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPanel();
  }
}

export function installPortal() {
  loadPaths();
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", handleKeyDown, true);
  const handlePortalUpdate = () => {
    loadPaths();
    updateBadge();
    if (panel) renderPanel();
  };
  window.addEventListener("scout:portal-updated", handlePortalUpdate);
  window.addEventListener("scout:reconcile-portal", handlePortalUpdate as EventListener);
  queueMicrotask(reconcile);
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scout:portal-updated", handlePortalUpdate);
    window.removeEventListener("scout:reconcile-portal", handlePortalUpdate as EventListener);
    closePanel();
    sidebarButton?.remove();
    sidebarButton = null;
  };
}

import { cancelOperation, enqueueAndWait } from "./operation-queue";

interface FolderSizeItem {
  name: string;
  path: string;
  kind: "directory" | "file" | "other";
  size: number;
}

interface FolderSizeScan {
  root: string;
  totalBytes: number;
  otherBytes: number;
  items: FolderSizeItem[];
}

interface Rect {
  item: FolderSizeItem;
  x: number;
  y: number;
  width: number;
  height: number;
}

let observer: MutationObserver | null = null;
let overlay: HTMLDivElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let activeJob: number | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

function scanRoot() {
  const rows = [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row.selected")];
  if (rows.length === 1 && rows[0].dataset.entryKind === "directory") return rows[0].dataset.entryPath ?? null;
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function close() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  overlay?.remove();
  overlay = null;
}

function splitItems(items: FolderSizeItem[]): [FolderSizeItem[], FolderSizeItem[]] {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (items.length <= 1 || total <= 0) return [items, []];
  let running = 0;
  let split = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < items.length - 1; index += 1) {
    running += items[index].size;
    const distance = Math.abs(total / 2 - running);
    if (distance <= bestDistance) {
      bestDistance = distance;
      split = index + 1;
    } else {
      break;
    }
  }
  return [items.slice(0, split), items.slice(split)];
}

function layout(items: FolderSizeItem[], x: number, y: number, width: number, height: number): Rect[] {
  if (!items.length || width <= 0 || height <= 0) return [];
  if (items.length === 1) return [{ item: items[0], x, y, width, height }];

  const [first, second] = splitItems(items);
  const total = items.reduce((sum, item) => sum + item.size, 0) || 1;
  const firstTotal = first.reduce((sum, item) => sum + item.size, 0);
  const ratio = Math.max(0.05, Math.min(0.95, firstTotal / total));

  if (width >= height) {
    const firstWidth = width * ratio;
    return [
      ...layout(first, x, y, firstWidth, height),
      ...layout(second, x + firstWidth, y, width - firstWidth, height),
    ];
  }

  const firstHeight = height * ratio;
  return [
    ...layout(first, x, y, width, firstHeight),
    ...layout(second, x, y + firstHeight, width, height - firstHeight),
  ];
}

function renderMap(container: HTMLElement, items: FolderSizeItem[]) {
  const rect = container.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return;
  container.replaceChildren();

  for (const tile of layout(items, 0, 0, rect.width, rect.height)) {
    const node = element("button", `disk-map-tile ${tile.item.kind}`);
    node.type = "button";
    node.style.left = `${tile.x}px`;
    node.style.top = `${tile.y}px`;
    node.style.width = `${Math.max(0, tile.width)}px`;
    node.style.height = `${Math.max(0, tile.height)}px`;
    node.title = `${tile.item.name}\n${formatBytes(tile.item.size)}${tile.item.path ? `\n${tile.item.path}` : ""}`;

    const label = element("span", "disk-map-name");
    label.textContent = tile.item.name;
    const size = element("span", "disk-map-size");
    size.textContent = formatBytes(tile.item.size);
    node.append(label, size);

    if (tile.item.kind === "directory") {
      node.addEventListener("click", () => {
        close();
        window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: tile.item.path } }));
      });
    } else {
      node.disabled = true;
    }
    container.append(node);
  }
}

async function openDiskMap() {
  const root = scanRoot();
  if (!root) return;
  close();

  overlay = element("div", "disk-map-backdrop");
  const sheet = element("section", "disk-map-sheet");
  const header = element("header", "disk-map-header");
  const heading = element("div", "disk-map-heading");
  const title = element("div", "disk-map-title");
  title.textContent = "Folder size map";
  const path = element("div", "disk-map-path");
  path.textContent = root;
  path.title = root;
  heading.append(title, path);
  const headerActions = element("div", "disk-map-header-actions");
  const cancelButton = element("button", "disk-map-close");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.hidden = true;
  cancelButton.addEventListener("click", () => {
    if (activeJob != null) void cancelOperation(activeJob);
  });
  const closeButton = element("button", "disk-map-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  headerActions.append(cancelButton, closeButton);
  header.append(heading, headerActions);

  const body = element("div", "disk-map-body");
  const loading = element("div", "disk-map-loading");
  loading.textContent = "Queued folder size scan…";
  body.append(loading);
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);

  try {
    cancelButton.hidden = false;
    const scan = await enqueueAndWait<FolderSizeScan>(
      "enqueue_folder_size_scan",
      { root, maxEntries: 80 },
      (job) => {
        activeJob = job.id;
        const progress = job.progress == null ? "" : ` · ${Math.round(job.progress * 100)}%`;
        loading.textContent = `${job.detail ?? "Calculating folder sizes…"}${progress}`;
      },
    );
    activeJob = null;
    cancelButton.hidden = true;
    if (!overlay) return;
    const summary = element("div", "disk-map-summary");
    summary.textContent = `${formatBytes(scan.totalBytes)} total · ${scan.items.length}${scan.otherBytes ? "+" : ""} visible items`;
    const map = element("div", "disk-map-canvas");
    const items = [...scan.items];
    if (scan.otherBytes > 0) items.push({ name: "Other", path: "", kind: "other", size: scan.otherBytes });
    body.replaceChildren(summary, map);
    resizeObserver = new ResizeObserver(() => renderMap(map, items));
    resizeObserver.observe(map);
    renderMap(map, items);
  } catch (error) {
    activeJob = null;
    cancelButton.hidden = true;
    body.replaceChildren();
    const message = element("div", "disk-map-error");
    message.textContent = String(error);
    body.append(message);
  }
}

function enhanceMenu(menu: HTMLElement) {
  if (menu.dataset.diskMapEnhanced === "1") return;
  menu.dataset.diskMapEnhanced = "1";
  const separator = element("div", "menu-separator disk-map-menu-separator");
  const button = element("button");
  button.type = "button";
  button.textContent = "Folder Size Map…";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.remove();
    void openDiskMap();
  });
  menu.append(separator, button);
}

function reconcile() {
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceMenu(menu);
}

export function installDiskMap() {
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer?.disconnect();
    observer = null;
    close();
  };
}

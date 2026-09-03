import { openEntry } from "./fs";
import { registerAction, type ScoutActionContext } from "./actions";
import { enqueueAndWait, type OperationJob } from "./operation-queue";

interface FileHealthItem {
  path: string;
  name: string;
  kind: string;
  size: number | null;
  issue: string;
}

interface FileHealthReport {
  root: string;
  scannedFiles: number;
  scannedDirectories: number;
  inaccessibleEntries: number;
  totalBytes: number;
  emptyFiles: FileHealthItem[];
  emptyDirectories: FileHealthItem[];
  brokenSymlinks: FileHealthItem[];
  largestFiles: FileHealthItem[];
}

let overlay: HTMLDivElement | null = null;
let currentRoot = "";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

function parentPath(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return path;
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.slice(0, index);
}

function close() {
  overlay?.remove();
  overlay = null;
}

async function copyPath(path: string) {
  await navigator.clipboard.writeText(path);
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message: "Copied path" } }));
}

function reveal(path: string) {
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: parentPath(path) } }));
  close();
}

function itemRow(item: FileHealthItem, showSize = false) {
  const row = element("article", "file-health-item");
  const copy = element("div", "file-health-item-copy");
  const name = element("strong", "file-health-item-name");
  name.textContent = item.name;
  name.title = item.path;
  const path = element("span", "file-health-item-path");
  path.textContent = item.path;
  path.title = item.path;
  copy.append(name, path);
  const meta = element("div", "file-health-item-meta");
  if (showSize) {
    const size = element("span", "file-health-size");
    size.textContent = formatBytes(item.size);
    meta.append(size);
  }
  const revealButton = element("button", "file-health-row-button");
  revealButton.type = "button";
  revealButton.textContent = "Reveal";
  revealButton.addEventListener("click", () => reveal(item.path));
  const copyButton = element("button", "file-health-row-button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Path";
  copyButton.addEventListener("click", () => void copyPath(item.path));
  meta.append(revealButton, copyButton);
  if (item.kind === "file" && item.size !== 0) {
    const openButton = element("button", "file-health-row-button");
    openButton.type = "button";
    openButton.textContent = "Open";
    openButton.addEventListener("click", () => void openEntry(item.path));
    meta.append(openButton);
  }
  row.append(copy, meta);
  return row;
}

function section(titleText: string, items: FileHealthItem[], options: { showSize?: boolean; emptyText: string }) {
  const wrapper = element("section", "file-health-section");
  const header = element("header", "file-health-section-header");
  const title = element("h3", "file-health-section-title");
  title.textContent = titleText;
  const count = element("span", "file-health-section-count");
  count.textContent = String(items.length);
  header.append(title, count);
  wrapper.append(header);
  if (!items.length) {
    const empty = element("div", "file-health-empty");
    empty.textContent = options.emptyText;
    wrapper.append(empty);
    return wrapper;
  }
  const list = element("div", "file-health-list");
  for (const item of items) list.append(itemRow(item, !!options.showSize));
  wrapper.append(list);
  return wrapper;
}

function summaryMetric(labelText: string, valueText: string) {
  const metric = element("div", "file-health-metric");
  const value = element("strong", "file-health-metric-value");
  value.textContent = valueText;
  const label = element("span", "file-health-metric-label");
  label.textContent = labelText;
  metric.append(value, label);
  return metric;
}

function renderReport(body: HTMLElement, report: FileHealthReport) {
  body.replaceChildren();
  const summary = element("section", "file-health-summary");
  summary.append(
    summaryMetric("Files", report.scannedFiles.toLocaleString()),
    summaryMetric("Folders", report.scannedDirectories.toLocaleString()),
    summaryMetric("Data", formatBytes(report.totalBytes)),
    summaryMetric("Issues", (report.emptyFiles.length + report.emptyDirectories.length + report.brokenSymlinks.length).toLocaleString()),
  );
  body.append(summary);
  if (report.inaccessibleEntries) {
    const warning = element("div", "file-health-warning");
    warning.textContent = `${report.inaccessibleEntries.toLocaleString()} item${report.inaccessibleEntries === 1 ? " was" : "s were"} inaccessible and skipped.`;
    body.append(warning);
  }
  body.append(
    section("Broken symlinks", report.brokenSymlinks, { emptyText: "No broken symbolic links found." }),
    section("Empty folders", report.emptyDirectories, { emptyText: "No empty folders found." }),
    section("Empty files", report.emptyFiles, { emptyText: "No empty files found." }),
    section("Largest files", report.largestFiles, { showSize: true, emptyText: "No files found." }),
  );
}

function updateProgress(body: HTMLElement, job: OperationJob<FileHealthReport>) {
  const status = body.querySelector<HTMLElement>(".file-health-progress-copy");
  const fill = body.querySelector<HTMLElement>(".file-health-progress-fill");
  if (status) status.textContent = job.detail || "Scanning…";
  if (fill && job.progress != null) fill.style.width = `${Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}%`;
}

async function runScan(root: string, body: HTMLElement) {
  currentRoot = root;
  body.replaceChildren();
  const progress = element("div", "file-health-progress");
  const copy = element("div", "file-health-progress-copy");
  copy.textContent = "Scanning files and folders…";
  const note = element("div", "file-health-progress-note");
  note.textContent = "The scan runs in Operations and can be cancelled there.";
  const track = element("div", "file-health-progress-track");
  const fill = element("div", "file-health-progress-fill");
  track.append(fill);
  progress.append(copy, note, track);
  body.append(progress);
  try {
    const report = await enqueueAndWait<FileHealthReport>(
      "enqueue_file_health_scan",
      { root, largestLimit: 50 },
      (job) => updateProgress(body, job),
    );
    if (!overlay || currentRoot !== root) return;
    renderReport(body, report);
  } catch (error) {
    if (!overlay || currentRoot !== root) return;
    body.replaceChildren();
    const failure = element("div", "file-health-failure");
    failure.textContent = error instanceof Error ? error.message : String(error);
    body.append(failure);
  }
}

function scanRoot(context: ScoutActionContext) {
  if (context.selection.length === 1 && context.selection[0].kind === "directory") return context.selection[0].path;
  return context.panePath;
}

function openFileHealth(context: ScoutActionContext) {
  const root = scanRoot(context);
  if (!root) throw new Error("No folder is available for File Health");
  close();
  overlay = element("div", "file-health-backdrop");
  const panel = element("section", "file-health-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "File Health");
  const header = element("header", "file-health-header");
  const heading = element("div", "file-health-heading");
  const title = element("h2", "file-health-title");
  title.textContent = "File Health";
  const subtitle = element("div", "file-health-subtitle");
  subtitle.textContent = root;
  subtitle.title = root;
  heading.append(title, subtitle);
  const actions = element("div", "file-health-header-actions");
  const rescan = element("button", "file-health-header-button");
  rescan.type = "button";
  rescan.textContent = "Rescan";
  const closeButton = element("button", "file-health-header-button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  actions.append(rescan, closeButton);
  header.append(heading, actions);
  const body = element("div", "file-health-body");
  panel.append(header, body);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  closeButton.addEventListener("click", close);
  rescan.addEventListener("click", () => void runScan(root, body));
  document.body.append(overlay);
  void runScan(root, body);
}

export function installFileHealth() {
  const unregister = registerAction({
    id: "tools.file-health",
    title: "File Health…",
    category: "Tools",
    subtitle: "Find empty items, broken symlinks, and large files",
    keywords: ["cleanup", "empty files", "empty folders", "broken link", "largest files", "czkawka", "health"],
    contextMenu: true,
    contextMenuOrder: 75,
    available: (context) => !!scanRoot(context),
    run: (context) => openFileHealth(context),
  });
  return () => {
    unregister();
    close();
  };
}

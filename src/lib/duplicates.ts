import { cancelOperation, enqueueAndWait } from "./operation-queue";

interface DuplicateGroup {
  size: number;
  digest: string;
  wastedBytes: number;
  paths: string[];
}

interface DuplicateScan {
  root: string;
  scannedFiles: number;
  duplicateFiles: number;
  duplicateBytes: number;
  groups: DuplicateGroup[];
}

let observer: MutationObserver | null = null;
let overlay: HTMLDivElement | null = null;
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

function selectedRows() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row.selected")];
}

function scanRoot() {
  const rows = selectedRows();
  if (rows.length === 1 && rows[0].dataset.entryKind === "directory") {
    return rows[0].dataset.entryPath ?? null;
  }
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function close() {
  overlay?.remove();
  overlay = null;
}

function createSheet() {
  close();
  overlay = element("div", "duplicate-backdrop");
  const sheet = element("section", "duplicate-sheet");
  const header = element("header", "duplicate-header");
  const title = element("div", "duplicate-title");
  title.textContent = "Duplicate finder";
  const closeButton = element("button", "duplicate-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  const body = element("div", "duplicate-body");
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  return body;
}

function renderScan(body: HTMLElement, scan: DuplicateScan) {
  const summary = element("div", "duplicate-summary");
  const values: Array<[string, string]> = [
    ["Scanned", scan.scannedFiles.toLocaleString()],
    ["Duplicate files", scan.duplicateFiles.toLocaleString()],
    ["Reclaimable", formatBytes(scan.duplicateBytes)],
  ];
  for (const [label, value] of values) {
    const metric = element("div", "duplicate-metric");
    const metricValue = element("strong");
    metricValue.textContent = value;
    const metricLabel = element("span");
    metricLabel.textContent = label;
    metric.append(metricValue, metricLabel);
    summary.append(metric);
  }

  const groups = element("div", "duplicate-groups");
  if (!scan.groups.length) {
    const empty = element("div", "duplicate-empty");
    empty.textContent = "No exact duplicates found above the selected size threshold.";
    groups.append(empty);
  } else {
    scan.groups.forEach((group, index) => {
      const card = element("section", "duplicate-group");
      const groupHeader = element("div", "duplicate-group-header");
      const label = element("div", "duplicate-group-title");
      label.textContent = `Group ${index + 1} · ${group.paths.length} copies`;
      const waste = element("div", "duplicate-group-waste");
      waste.textContent = `${formatBytes(group.size)} each · ${formatBytes(group.wastedBytes)} reclaimable`;
      groupHeader.append(label, waste);

      const pathList = element("div", "duplicate-paths");
      for (const path of group.paths) {
        const row = element("div", "duplicate-path");
        row.textContent = path;
        row.title = path;
        pathList.append(row);
      }

      const footer = element("div", "duplicate-group-footer");
      const digest = element("code", "duplicate-digest");
      digest.textContent = group.digest;
      const copy = element("button", "duplicate-copy");
      copy.type = "button";
      copy.textContent = "Copy paths";
      copy.addEventListener("click", () => void navigator.clipboard.writeText(group.paths.join("\n")));
      footer.append(digest, copy);
      card.append(groupHeader, pathList, footer);
      groups.append(card);
    });
  }

  body.replaceChildren(summary, groups);
}

async function openDuplicateFinder() {
  const root = scanRoot();
  if (!root) return;
  const body = createSheet();

  const controls = element("div", "duplicate-controls");
  const rootLabel = element("div", "duplicate-root");
  rootLabel.textContent = root;
  rootLabel.title = root;
  const sizeLabel = element("label", "duplicate-size-field");
  const caption = element("span");
  caption.textContent = "Minimum file size";
  const size = element("select", "duplicate-select");
  for (const [label, bytes] of [["100 KB", 102400], ["1 MB", 1048576], ["10 MB", 10485760], ["100 MB", 104857600]] as const) {
    const option = document.createElement("option");
    option.value = String(bytes);
    option.textContent = label;
    if (bytes === 1048576) option.selected = true;
    size.append(option);
  }
  sizeLabel.append(caption, size);
  const scan = element("button", "duplicate-scan-button");
  scan.type = "button";
  scan.textContent = "Scan";
  const cancel = element("button", "duplicate-copy");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.hidden = true;
  cancel.addEventListener("click", () => {
    if (activeJob != null) void cancelOperation(activeJob);
  });
  controls.append(rootLabel, sizeLabel, scan, cancel);
  const results = element("div", "duplicate-results");
  const intro = element("div", "duplicate-intro");
  intro.textContent = "Scout groups files by size first, then SHA-256 hashes only candidates that could be duplicates.";
  results.append(intro);
  body.append(controls, results);

  const run = async () => {
    scan.disabled = true;
    scan.textContent = "Scanning…";
    cancel.hidden = false;
    results.classList.remove("duplicate-error");
    results.textContent = "Queued duplicate scan…";
    try {
      const result = await enqueueAndWait<DuplicateScan>(
        "enqueue_duplicate_scan",
        { root, minSize: Number(size.value) },
        (job) => {
          activeJob = job.id;
          const progress = job.progress == null ? "" : ` · ${Math.round(job.progress * 100)}%`;
          results.textContent = `${job.detail ?? "Scanning files…"}${progress}`;
        },
      );
      if (!overlay) return;
      renderScan(results, result);
    } catch (error) {
      results.textContent = String(error);
      results.classList.add("duplicate-error");
    } finally {
      activeJob = null;
      cancel.hidden = true;
      scan.disabled = false;
      scan.textContent = "Scan";
    }
  };
  scan.addEventListener("click", () => void run());
}

function enhanceMenu(menu: HTMLElement) {
  if (menu.dataset.duplicatesEnhanced === "1") return;
  menu.dataset.duplicatesEnhanced = "1";
  const separator = element("div", "menu-separator duplicate-menu-separator");
  const button = element("button");
  button.type = "button";
  button.textContent = "Find Duplicates…";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.remove();
    void openDuplicateFinder();
  });
  menu.append(separator, button);
}

function reconcile() {
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceMenu(menu);
}

export function installDuplicateFinder() {
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer?.disconnect();
    observer = null;
    close();
  };
}

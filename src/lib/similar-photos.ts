import { openEntry } from "./fs";
import { cancelOperation, enqueueAndWait } from "./operation-queue";
import { thumbnailEntry } from "./preview";

interface SimilarPhotoItem {
  path: string;
  name: string;
  distance: number;
}

interface SimilarPhotoGroup {
  representative: string;
  files: SimilarPhotoItem[];
}

interface SimilarPhotoScan {
  root: string;
  scanned: number;
  truncated: boolean;
  groups: SimilarPhotoGroup[];
}

let observer: MutationObserver | null = null;
let overlay: HTMLDivElement | null = null;
let scanToken = 0;
let activeJob: number | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function scanRoot() {
  const rows = [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row.selected")];
  if (rows.length === 1 && rows[0].dataset.entryKind === "directory") return rows[0].dataset.entryPath ?? null;
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function close() {
  scanToken += 1;
  overlay?.remove();
  overlay = null;
}

async function hydrateThumbnail(node: HTMLElement, path: string) {
  try {
    const dataUrl = await thumbnailEntry(path);
    if (!node.isConnected || !dataUrl) return;
    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = "";
    image.draggable = false;
    node.replaceChildren(image);
  } catch {
    // Keep the neutral placeholder when an individual thumbnail cannot be decoded.
  }
}

function similarityLabel(distance: number) {
  const similarity = Math.round((1 - distance / 64) * 100);
  return `${similarity}%`;
}

function renderGroup(group: SimilarPhotoGroup, index: number) {
  const section = element("section", "similar-group");
  const header = element("div", "similar-group-header");
  const label = element("span", "similar-group-title");
  label.textContent = `Group ${index + 1}`;
  const count = element("span", "similar-group-count");
  count.textContent = `${group.files.length} photos`;
  header.append(label, count);

  const grid = element("div", "similar-photo-grid");
  for (const item of group.files) {
    const card = element("button", "similar-photo-card");
    card.type = "button";
    card.title = item.path;
    const thumbnail = element("span", "similar-photo-thumbnail");
    const info = element("span", "similar-photo-info");
    const name = element("span", "similar-photo-name");
    name.textContent = item.name;
    const score = element("span", "similar-photo-score");
    score.textContent = item.distance === 0 ? "Reference" : similarityLabel(item.distance);
    info.append(name, score);
    card.append(thumbnail, info);
    card.addEventListener("click", () => void openEntry(item.path));
    grid.append(card);
    void hydrateThumbnail(thumbnail, item.path);
  }
  section.append(header, grid);
  return section;
}

async function runScan(
  root: string,
  threshold: number,
  body: HTMLElement,
  runButton: HTMLButtonElement,
  cancelButton: HTMLButtonElement,
) {
  const token = ++scanToken;
  runButton.disabled = true;
  runButton.textContent = "Scanning…";
  cancelButton.hidden = false;
  const status = element("div", "similar-loading");
  status.textContent = "Queued similar-photo scan…";
  body.replaceChildren(status);

  try {
    const result = await enqueueAndWait<SimilarPhotoScan>(
      "enqueue_similar_photo_scan",
      { root, threshold, maxFiles: 2500 },
      (job) => {
        activeJob = job.id;
        if (token !== scanToken || !status.isConnected) return;
        const progress = job.progress == null ? "" : ` · ${Math.round(job.progress * 100)}%`;
        status.textContent = `${job.detail ?? "Scanning local images…"}${progress}`;
      },
    );
    activeJob = null;
    if (token !== scanToken || !overlay) return;
    body.replaceChildren();
    const summary = element("div", "similar-summary");
    const suffix = result.truncated ? " · first 2,500 images" : "";
    summary.textContent = `${result.scanned.toLocaleString()} images scanned · ${result.groups.length} similar groups${suffix}`;
    body.append(summary);
    if (!result.groups.length) {
      const empty = element("div", "similar-empty");
      empty.textContent = "No visually similar groups found at this sensitivity.";
      body.append(empty);
    } else {
      const groups = element("div", "similar-groups");
      result.groups.forEach((group, index) => groups.append(renderGroup(group, index)));
      body.append(groups);
    }
  } catch (error) {
    activeJob = null;
    if (token !== scanToken || !overlay) return;
    const message = element("div", "similar-error");
    message.textContent = String(error);
    body.replaceChildren(message);
  } finally {
    if (token === scanToken && runButton.isConnected) {
      cancelButton.hidden = true;
      runButton.disabled = false;
      runButton.textContent = "Scan again";
    }
  }
}

function openSimilarPhotos() {
  const root = scanRoot();
  if (!root) return;
  close();

  overlay = element("div", "similar-backdrop");
  const sheet = element("section", "similar-sheet");
  const header = element("header", "similar-header");
  const heading = element("div", "similar-heading");
  const title = element("div", "similar-title");
  title.textContent = "Similar photos";
  const path = element("div", "similar-path");
  path.textContent = root;
  path.title = root;
  heading.append(title, path);
  const closeButton = element("button", "similar-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(heading, closeButton);

  const controls = element("div", "similar-controls");
  const sensitivity = element("select", "similar-select");
  for (const [value, label] of [["3", "Near duplicates"], ["6", "Similar"], ["10", "Loose"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === "6") option.selected = true;
    sensitivity.append(option);
  }
  const runButton = element("button", "similar-run");
  runButton.type = "button";
  runButton.textContent = "Scan";
  const cancelButton = element("button", "similar-close");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.hidden = true;
  cancelButton.addEventListener("click", () => {
    if (activeJob != null) void cancelOperation(activeJob);
  });
  controls.append(sensitivity, runButton, cancelButton);
  const body = element("div", "similar-body");
  const intro = element("div", "similar-empty");
  intro.textContent = "Scout compares compact local image fingerprints. Nothing leaves this computer.";
  body.append(intro);
  runButton.addEventListener("click", () =>
    void runScan(root, Number(sensitivity.value), body, runButton, cancelButton),
  );

  sheet.append(header, controls, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  void runScan(root, Number(sensitivity.value), body, runButton, cancelButton);
}

function enhanceMenu(menu: HTMLElement) {
  if (menu.dataset.similarPhotosEnhanced === "1") return;
  menu.dataset.similarPhotosEnhanced = "1";
  const separator = element("div", "menu-separator similar-menu-separator");
  const button = element("button");
  button.type = "button";
  button.textContent = "Find Similar Photos…";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.remove();
    openSimilarPhotos();
  });
  menu.append(separator, button);
}

function reconcile() {
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceMenu(menu);
}

export function installSimilarPhotos() {
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer?.disconnect();
    observer = null;
    close();
  };
}

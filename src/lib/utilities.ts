import { invoke } from "@tauri-apps/api/core";

interface ChecksumResult {
  path: string;
  algorithm: string;
  digest: string;
}

interface RenamePreview {
  source: string;
  destination: string;
  currentName: string;
  nextName: string;
  valid: boolean;
  error: string | null;
}

interface ArchiveOperationResult {
  path: string;
  entries: number;
}

let observer: MutationObserver | null = null;
let overlay: HTMLDivElement | null = null;
let toast: HTMLDivElement | null = null;
let renameTimer: number | undefined;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function selectedRows() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row.selected")];
}

function selectedPaths() {
  return selectedRows()
    .map((row) => row.dataset.entryPath)
    .filter((path): path is string => !!path);
}

function activeDirectory() {
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function selectedIsSingleZip() {
  const rows = selectedRows();
  return rows.length === 1 && rows[0].dataset.entryExtension?.toLocaleLowerCase() === "zip";
}

function selectedAreFiles() {
  const rows = selectedRows();
  return rows.length > 0 && rows.every((row) => row.dataset.entryKind === "file");
}

function closeOverlay() {
  if (renameTimer !== undefined) window.clearTimeout(renameTimer);
  renameTimer = undefined;
  overlay?.remove();
  overlay = null;
}

function showToast(message: string, error = false) {
  toast?.remove();
  toast = element("div", `utility-toast${error ? " error" : ""}`);
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => {
    toast?.remove();
    toast = null;
  }, error ? 4200 : 2600);
}

function createOverlay(titleText: string) {
  closeOverlay();
  overlay = element("div", "utility-backdrop");
  const sheet = element("section", "utility-sheet");
  const header = element("header", "utility-header");
  const title = element("div", "utility-title");
  title.textContent = titleText;
  const close = element("button", "utility-close");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", closeOverlay);
  header.append(title, close);
  const body = element("div", "utility-body");
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.body.append(overlay);
  return body;
}

async function openChecksums() {
  const paths = selectedPaths();
  if (!paths.length || !selectedAreFiles()) {
    showToast("Select one or more files for SHA-256", true);
    return;
  }

  const body = createOverlay("SHA-256 checksums");
  const loading = element("div", "utility-loading");
  loading.textContent = "Calculating checksums…";
  body.append(loading);

  try {
    const results = await invoke<ChecksumResult[]>("checksum_entries", { paths });
    if (!overlay) return;
    const list = element("div", "checksum-list");
    for (const result of results) {
      const row = element("div", "checksum-row");
      const info = element("div", "checksum-info");
      const name = element("div", "checksum-name");
      name.textContent = result.path.split(/[\\/]/).pop() ?? result.path;
      const digest = element("code", "checksum-digest");
      digest.textContent = result.digest;
      info.append(name, digest);
      const copy = element("button", "utility-secondary-button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => void navigator.clipboard.writeText(result.digest));
      row.append(info, copy);
      list.append(row);
    }
    body.replaceChildren(list);
  } catch (error) {
    body.replaceChildren();
    const message = element("div", "utility-error");
    message.textContent = String(error);
    body.append(message);
  }
}

function openBatchRename() {
  const paths = selectedPaths();
  if (paths.length < 2) {
    showToast("Select at least two items for batch rename", true);
    return;
  }

  const body = createOverlay("Batch rename");
  const controls = element("div", "rename-controls");
  const templateLabel = element("label", "utility-field");
  const templateCaption = element("span");
  templateCaption.textContent = "Template";
  const templateInput = element("input", "utility-input");
  templateInput.value = "{n} - {name}";
  templateInput.spellcheck = false;
  templateLabel.append(templateCaption, templateInput);

  const startLabel = element("label", "utility-field compact");
  const startCaption = element("span");
  startCaption.textContent = "Start";
  const startInput = element("input", "utility-input");
  startInput.type = "number";
  startInput.min = "0";
  startInput.value = "1";
  startLabel.append(startCaption, startInput);
  controls.append(templateLabel, startLabel);

  const hint = element("div", "rename-hint");
  hint.textContent = "Placeholders: {name} full filename · {stem} name only · {ext} extension · {n} number";
  const previewNode = element("div", "rename-preview");
  const footer = element("div", "utility-actions");
  const cancel = element("button", "utility-secondary-button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeOverlay);
  const apply = element("button", "utility-primary-button");
  apply.type = "button";
  apply.textContent = "Rename";
  apply.disabled = true;
  footer.append(cancel, apply);
  body.append(controls, hint, previewNode, footer);

  let preview: RenamePreview[] = [];
  let token = 0;

  const refresh = async () => {
    const currentToken = ++token;
    previewNode.textContent = "Previewing…";
    apply.disabled = true;
    try {
      const next = await invoke<RenamePreview[]>("preview_batch_rename", {
        paths,
        template: templateInput.value,
        start: Math.max(0, Number(startInput.value) || 0),
      });
      if (currentToken !== token || !overlay) return;
      preview = next;
      previewNode.replaceChildren();
      for (const item of preview) {
        const row = element("div", `rename-preview-row${item.valid ? "" : " invalid"}`);
        const before = element("span", "rename-before");
        before.textContent = item.currentName;
        const arrow = element("span", "rename-arrow");
        arrow.textContent = "→";
        const after = element("span", "rename-after");
        after.textContent = item.error ?? item.nextName;
        row.append(before, arrow, after);
        previewNode.append(row);
      }
      apply.disabled = preview.length === 0 || preview.some((item) => !item.valid);
    } catch (error) {
      preview = [];
      previewNode.textContent = String(error);
      apply.disabled = true;
    }
  };

  const schedule = () => {
    if (renameTimer !== undefined) window.clearTimeout(renameTimer);
    renameTimer = window.setTimeout(() => {
      renameTimer = undefined;
      void refresh();
    }, 80);
  };
  templateInput.addEventListener("input", schedule);
  startInput.addEventListener("input", schedule);
  apply.addEventListener("click", async () => {
    if (!preview.length || preview.some((item) => !item.valid)) return;
    apply.disabled = true;
    apply.textContent = "Renaming…";
    try {
      await invoke<void>("apply_batch_rename", {
        operations: preview.map((item) => ({ source: item.source, destination: item.destination })),
      });
      closeOverlay();
      showToast(`Renamed ${preview.length} items`);
    } catch (error) {
      apply.disabled = false;
      apply.textContent = "Rename";
      showToast(String(error), true);
    }
  });

  void refresh();
  templateInput.focus();
  templateInput.select();
}

async function createZip() {
  const paths = selectedPaths();
  const destination = activeDirectory();
  if (!paths.length || !destination) return;
  showToast("Creating ZIP archive…");
  try {
    const result = await invoke<ArchiveOperationResult>("create_zip_archive", { paths, destination });
    showToast(`Created ${result.path.split(/[\\/]/).pop() ?? "archive"}`);
  } catch (error) {
    showToast(String(error), true);
  }
}

async function extractZip() {
  const paths = selectedPaths();
  const destination = activeDirectory();
  if (paths.length !== 1 || !destination || !selectedIsSingleZip()) return;
  showToast("Extracting ZIP archive…");
  try {
    const result = await invoke<ArchiveOperationResult>("extract_zip_archive", { path: paths[0], destination });
    showToast(`Extracted ${result.entries} items`);
  } catch (error) {
    showToast(String(error), true);
  }
}

function menuButton(label: string, action: () => void) {
  const button = element("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
    document.querySelector<HTMLElement>(".context-menu")?.remove();
  });
  return button;
}

function enhanceContextMenu(menu: HTMLElement) {
  if (menu.dataset.utilitiesEnhanced === "1") return;
  menu.dataset.utilitiesEnhanced = "1";
  const paths = selectedPaths();
  if (!paths.length) return;

  const separator = element("div", "menu-separator utility-menu-separator");
  menu.append(separator);
  if (selectedAreFiles()) menu.append(menuButton("SHA-256 Checksum", () => void openChecksums()));
  if (paths.length > 1) menu.append(menuButton("Batch Rename…", openBatchRename));
  menu.append(menuButton("Compress to ZIP", () => void createZip()));
  if (selectedIsSingleZip()) menu.append(menuButton("Extract ZIP Here", () => void extractZip()));
}

function reconcileMenus() {
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceContextMenu(menu);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier || !event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "h") {
    event.preventDefault();
    void openChecksums();
  } else if (key === "r") {
    event.preventDefault();
    openBatchRename();
  }
}

export function installUtilities() {
  observer = new MutationObserver(reconcileMenus);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("keydown", handleKeyDown, true);
    closeOverlay();
    toast?.remove();
    toast = null;
  };
}

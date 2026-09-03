import { invoke } from "@tauri-apps/api/core";
import { registerAction, type ScoutActionContext } from "./actions";
import { enqueueAndWait } from "./operation-queue";

interface PdfMetadataEntry {
  key: string;
  value: string;
}

interface PdfInfo {
  path: string;
  pages: number;
  encrypted: boolean;
  metadata: PdfMetadataEntry[];
}

interface PdfOperationResult {
  paths: string[];
  pages: number;
}

let overlay: HTMLDivElement | null = null;
let toast: HTMLDivElement | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function pdfPaths(context: ScoutActionContext) {
  if (!context.panePath || !context.selection.length) return [];
  if (!context.selection.every((entry) => entry.kind === "file" && entry.extension?.toLowerCase() === "pdf")) return [];
  return context.selectedPaths;
}

function closeOverlay() {
  overlay?.remove();
  overlay = null;
}

function showToast(message: string, error = false) {
  toast?.remove();
  toast = element("div", `pdf-toast${error ? " error" : ""}`);
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => {
    toast?.remove();
    toast = null;
  }, error ? 4200 : 2600);
}

function createOverlay(titleText: string) {
  closeOverlay();
  overlay = element("div", "pdf-backdrop");
  const sheet = element("section", "pdf-sheet");
  const header = element("header", "pdf-header");
  const title = element("div", "pdf-title");
  title.textContent = titleText;
  const close = element("button", "pdf-close");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", closeOverlay);
  header.append(title, close);
  const body = element("div", "pdf-body");
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.body.append(overlay);
  return body;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function parsePageSpec(value: string, total: number) {
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > total || end > total) {
        throw new Error(`Page range ${part} must stay within 1–${total}`);
      }
      const direction = start <= end ? 1 : -1;
      for (let page = start; ; page += direction) {
        if (seen.has(page)) throw new Error(`Page ${page} appears more than once`);
        seen.add(page);
        pages.push(page);
        if (page === end) break;
      }
      continue;
    }
    if (!/^\d+$/.test(part)) throw new Error(`Invalid page token: ${part}`);
    const page = Number(part);
    if (page < 1 || page > total) throw new Error(`Page ${page} must stay within 1–${total}`);
    if (seen.has(page)) throw new Error(`Page ${page} appears more than once`);
    seen.add(page);
    pages.push(page);
  }
  if (!pages.length) throw new Error("Choose at least one page");
  return pages;
}

function button(label: string, className = "pdf-secondary") {
  const node = element("button", className);
  node.type = "button";
  node.textContent = label;
  return node;
}

async function runOperation(command: string, args: Record<string, unknown>, label: string) {
  try {
    showToast(`${label} · added to Operations`);
    const result = await enqueueAndWait<PdfOperationResult>("enqueue_pdf_operation", {
      request: { operation: command, ...args },
    });
    closeOverlay();
    showToast(result.paths.length === 1 ? `Created ${basename(result.paths[0])}` : `Created ${result.paths.length} PDFs`);
  } catch (error) {
    showToast(String(error), true);
  }
}

function pageInputRow(info: PdfInfo) {
  const wrap = element("label", "pdf-field");
  const caption = element("span");
  caption.textContent = "Pages";
  const input = element("input", "pdf-input");
  input.value = `1-${info.pages}`;
  input.spellcheck = false;
  input.placeholder = "1-3, 6, 9";
  wrap.append(caption, input);
  return { wrap, input };
}

async function openSinglePdf(path: string, destination: string) {
  const body = createOverlay("PDF Tools");
  const loading = element("div", "pdf-loading");
  loading.textContent = "Reading PDF…";
  body.append(loading);

  try {
    const info = await invoke<PdfInfo>("pdf_info", { path });
    if (!overlay) return;
    body.replaceChildren();

    const summary = element("div", "pdf-summary");
    const summaryText = element("div");
    const name = element("div", "pdf-name");
    name.textContent = basename(info.path);
    const detail = element("div", "pdf-detail");
    detail.textContent = `${info.pages} page${info.pages === 1 ? "" : "s"}${info.encrypted ? " · encrypted" : ""}`;
    summaryText.append(name, detail);
    summary.append(summaryText);
    body.append(summary);

    const pagesSection = element("section", "pdf-section");
    const pagesTitle = element("h3");
    pagesTitle.textContent = "Pages";
    const { wrap: pageField, input: pageInput } = pageInputRow(info);
    const pageHint = element("p", "pdf-hint");
    pageHint.textContent = "Use commas and ranges. Example: 1-3, 7, 10-8.";
    const pageActions = element("div", "pdf-action-grid");
    const extract = button("Extract pages");
    const split = button("Split to files");
    const remove = button("Delete pages", "pdf-secondary danger");
    const rotateLeft = button("Rotate left");
    const rotateRight = button("Rotate right");
    pageActions.append(extract, split, remove, rotateLeft, rotateRight);
    pagesSection.append(pagesTitle, pageField, pageHint, pageActions);
    body.append(pagesSection);

    const readPages = () => parsePageSpec(pageInput.value, info.pages);
    extract.addEventListener("click", () => {
      try {
        void runOperation("extract_pdf_pages", { path, pages: readPages(), destination }, "Extracting pages");
      } catch (error) {
        showToast(String(error), true);
      }
    });
    split.addEventListener("click", () => {
      try {
        void runOperation("split_pdf_pages", { path, pages: readPages(), destination }, "Splitting pages");
      } catch (error) {
        showToast(String(error), true);
      }
    });
    remove.addEventListener("click", () => {
      try {
        void runOperation("delete_pdf_pages", { path, pages: readPages(), destination }, "Removing pages");
      } catch (error) {
        showToast(String(error), true);
      }
    });
    rotateLeft.addEventListener("click", () => {
      try {
        void runOperation("rotate_pdf_pages", { path, pages: readPages(), angle: -90, destination }, "Rotating pages");
      } catch (error) {
        showToast(String(error), true);
      }
    });
    rotateRight.addEventListener("click", () => {
      try {
        void runOperation("rotate_pdf_pages", { path, pages: readPages(), angle: 90, destination }, "Rotating pages");
      } catch (error) {
        showToast(String(error), true);
      }
    });

    if (info.pages > 1) {
      const reorderSection = element("section", "pdf-section");
      const reorderTitle = element("h3");
      reorderTitle.textContent = "Reorder";
      const reorderField = element("label", "pdf-field");
      const reorderCaption = element("span");
      reorderCaption.textContent = "New page order";
      const reorderInput = element("input", "pdf-input");
      reorderInput.value = `1-${info.pages}`;
      reorderInput.spellcheck = false;
      reorderField.append(reorderCaption, reorderInput);
      const reorderHint = element("p", "pdf-hint");
      reorderHint.textContent = `Include every page exactly once. Reverse with ${info.pages}-1.`;
      const reorder = button("Create reordered PDF", "pdf-primary");
      reorder.addEventListener("click", () => {
        try {
          const pages = parsePageSpec(reorderInput.value, info.pages);
          if (pages.length !== info.pages) throw new Error(`Reorder must include all ${info.pages} pages`);
          void runOperation("reorder_pdf_pages", { path, pages, destination }, "Reordering pages");
        } catch (error) {
          showToast(String(error), true);
        }
      });
      reorderSection.append(reorderTitle, reorderField, reorderHint, reorder);
      body.append(reorderSection);
    }

    const optimizeSection = element("section", "pdf-section");
    const optimizeTitle = element("h3");
    optimizeTitle.textContent = "Optimize & privacy";
    const optimizeActions = element("div", "pdf-action-grid");
    const compress = button("Compress PDF");
    const stripMetadata = button("Remove metadata");
    compress.addEventListener("click", () => void runOperation("compress_pdf", { path, destination }, "Compressing PDF"));
    stripMetadata.addEventListener("click", () => void runOperation("strip_pdf_metadata", { path, destination }, "Removing metadata"));
    optimizeActions.append(compress, stripMetadata);
    optimizeSection.append(optimizeTitle, optimizeActions);
    body.append(optimizeSection);

    const metadataSection = element("section", "pdf-section");
    const metadataTitle = element("h3");
    metadataTitle.textContent = "Metadata";
    const metadataList = element("div", "pdf-metadata");
    if (info.metadata.length) {
      for (const item of info.metadata) {
        const row = element("div", "pdf-metadata-row");
        const key = element("span", "pdf-metadata-key");
        key.textContent = item.key;
        const value = element("span", "pdf-metadata-value");
        value.textContent = item.value;
        row.append(key, value);
        metadataList.append(row);
      }
    } else {
      const empty = element("div", "pdf-empty");
      empty.textContent = "No document-info metadata found.";
      metadataList.append(empty);
    }
    metadataSection.append(metadataTitle, metadataList);
    body.append(metadataSection);
  } catch (error) {
    body.replaceChildren();
    const message = element("div", "pdf-error");
    message.textContent = String(error);
    body.append(message);
  }
}

function openMultiPdf(paths: string[], destination: string) {
  const body = createOverlay("Merge PDFs");
  const intro = element("p", "pdf-intro");
  intro.textContent = "Scout will merge the selected PDFs in their current selection order and create a new file in this folder.";
  const list = element("div", "pdf-file-list");
  paths.forEach((path, index) => {
    const row = element("div", "pdf-file-row");
    const number = element("span", "pdf-file-number");
    number.textContent = String(index + 1);
    const name = element("span");
    name.textContent = basename(path);
    row.append(number, name);
    list.append(row);
  });
  const actions = element("div", "pdf-footer");
  const cancel = button("Cancel");
  cancel.addEventListener("click", closeOverlay);
  const merge = button(`Merge ${paths.length} PDFs`, "pdf-primary");
  merge.addEventListener("click", () => void runOperation("merge_pdfs", { paths, destination }, "Merging PDFs"));
  actions.append(cancel, merge);
  body.append(intro, list, actions);
}

function openPdfTools(paths: string[], destination: string) {
  if (!paths.length) {
    showToast("Select one or more PDF files", true);
    return;
  }
  if (paths.length === 1) void openSinglePdf(paths[0], destination);
  else openMultiPdf(paths, destination);
}

export function installPdfTools() {
  const unregister = registerAction({
    id: "tools.pdf",
    title: "PDF Tools…",
    category: "Tools",
    keywords: ["pdf", "merge", "split", "compress", "rotate", "metadata", "pages"],
    contextMenu: true,
    contextMenuOrder: 123,
    available: (context) => pdfPaths(context).length > 0,
    run: (context) => {
      const paths = pdfPaths(context);
      if (!paths.length || !context.panePath) throw new Error("Select one or more PDF files");
      openPdfTools(paths, context.panePath);
    },
  });

  return () => {
    unregister();
    closeOverlay();
    toast?.remove();
    toast = null;
  };
}

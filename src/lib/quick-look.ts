import { getActiveListing } from "./fs";
import { previewEntry } from "./preview";
import type { PreviewChild, PreviewData, PreviewMetadataItem } from "../types";

let overlay: HTMLDivElement | null = null;
let content: HTMLDivElement | null = null;
let title: HTMLDivElement | null = null;
let subtitle: HTMLDivElement | null = null;
let requestToken = 0;
let openPath: string | null = null;

function formatBytes(value: number | null) {
  if (value === null) return "—";
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

function selectedPath() {
  const row = document.querySelector<HTMLElement>(
    ".explorer-pane.active .pane-file-row.selected, .explorer-pane.active .file-row.selected, .file-row.selected",
  );
  if (!row) return null;
  const directPath = row.dataset.entryPath;
  if (directPath) return directPath;
  const listing = getActiveListing();
  if (!listing) return null;
  const index = Number(row.dataset.entryIndex);
  if (!Number.isInteger(index)) return null;
  return listing.entries[index]?.path ?? null;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string) {
  const node = element(tag, className);
  node.textContent = value;
  return node;
}

function detailRow(label: string, value: string) {
  const row = element("div", "quick-look-detail-row");
  row.append(textElement("span", "quick-look-detail-label", label));
  row.append(textElement("span", "quick-look-detail-value", value));
  return row;
}

function metadataRow(item: PreviewMetadataItem) {
  return detailRow(item.label, item.value);
}

function metadataPanel(preview: PreviewData) {
  const panel = element("aside", "quick-look-metadata");
  if (preview.width && preview.height) panel.append(detailRow("Dimensions", `${preview.width} × ${preview.height}`));
  if (preview.size !== null) panel.append(detailRow("Size", formatBytes(preview.size)));
  if (preview.extension) panel.append(detailRow("Type", preview.extension.toUpperCase()));
  for (const item of preview.metadata) panel.append(metadataRow(item));
  return panel;
}

function folderRow(child: PreviewChild) {
  const row = element("div", "quick-look-folder-row");
  const glyph = element("span", `quick-look-folder-glyph ${child.kind}`);
  const name = textElement("span", "quick-look-folder-name", child.name);
  const size = textElement("span", "quick-look-folder-size", child.kind === "directory" ? "" : formatBytes(child.size));
  row.append(glyph, name, size);
  return row;
}

function renderDirectory(preview: PreviewData) {
  const wrapper = element("div", "quick-look-folder-preview");
  const list = element("div", "quick-look-folder-list");
  for (const child of preview.children) list.append(folderRow(child));
  if (preview.children.length === 0) list.append(textElement("div", "quick-look-empty", "This folder is empty."));
  if (preview.truncated) list.append(textElement("div", "quick-look-truncated", "More items…"));
  wrapper.append(list);
  return wrapper;
}

function renderImage(preview: PreviewData) {
  const wrapper = element("div", "quick-look-image-layout");
  const stage = element("div", "quick-look-image-stage");
  if (preview.dataUrl) {
    const image = element("img", "quick-look-image");
    image.src = preview.dataUrl;
    image.alt = preview.name;
    stage.append(image);
  }
  wrapper.append(stage, metadataPanel(preview));
  return wrapper;
}

function renderText(preview: PreviewData) {
  const wrapper = element("div", "quick-look-text-layout");
  const code = element("pre", "quick-look-text");
  code.textContent = preview.text ?? "";
  wrapper.append(code);
  if (preview.truncated) wrapper.append(textElement("div", "quick-look-truncated", "Preview truncated at 512 KB."));
  return wrapper;
}

function renderMarkdown(preview: PreviewData) {
  const wrapper = element("div", "quick-look-markdown-layout");
  const article = element("article", "quick-look-markdown");
  const lines = (preview.text ?? "").split(/\r?\n/);
  let codeBlock: HTMLPreElement | null = null;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (codeBlock) {
        article.append(codeBlock);
        codeBlock = null;
      } else {
        codeBlock = element("pre", "quick-look-markdown-code");
      }
      continue;
    }
    if (codeBlock) {
      codeBlock.textContent += `${line}\n`;
      continue;
    }
    if (!line.trim()) {
      article.append(element("div", "quick-look-markdown-space"));
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const node = document.createElement(`h${level}`) as HTMLHeadingElement;
      node.textContent = heading[2];
      article.append(node);
      continue;
    }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      article.append(element("hr"));
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      article.append(textElement("div", "quick-look-markdown-list-item", `• ${bullet[1]}`));
      continue;
    }
    const numbered = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    if (numbered) {
      article.append(textElement("div", "quick-look-markdown-list-item", `${numbered[1]}. ${numbered[2]}`));
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      article.append(textElement("blockquote", "", quote[1]));
      continue;
    }
    article.append(textElement("p", "", line));
  }

  if (codeBlock) article.append(codeBlock);
  wrapper.append(article);
  if (preview.truncated) wrapper.append(textElement("div", "quick-look-truncated", "Preview truncated at 512 KB."));
  return wrapper;
}

function binaryUnavailable(preview: PreviewData, label: string) {
  const wrapper = element("div", "quick-look-unsupported");
  wrapper.append(textElement("div", "quick-look-unsupported-title", `${label} preview unavailable`));
  wrapper.append(textElement("div", "quick-look-unsupported-copy", preview.metadata[0]?.value ?? "This file cannot be previewed inline."));
  return wrapper;
}

function renderPdf(preview: PreviewData) {
  if (!preview.dataUrl) return binaryUnavailable(preview, "PDF");
  const wrapper = element("div", "quick-look-pdf-layout");
  const frame = element("iframe", "quick-look-pdf");
  frame.src = preview.dataUrl;
  frame.title = preview.name;
  wrapper.append(frame);
  return wrapper;
}

function renderMedia(preview: PreviewData, kind: "audio" | "video") {
  if (!preview.dataUrl) return binaryUnavailable(preview, kind === "audio" ? "Audio" : "Video");
  const wrapper = element("div", `quick-look-media-layout ${kind}`);
  const media = document.createElement(kind);
  media.className = "quick-look-media";
  media.controls = true;
  media.preload = "metadata";
  media.src = preview.dataUrl;
  if (kind === "video") (media as HTMLVideoElement).playsInline = true;
  wrapper.append(media, metadataPanel(preview));
  return wrapper;
}

function renderUnsupported(preview: PreviewData) {
  const wrapper = element("div", "quick-look-unsupported");
  wrapper.append(textElement("div", "quick-look-unsupported-title", "Preview not available yet"));
  wrapper.append(textElement("div", "quick-look-unsupported-copy", preview.extension ? `${preview.extension.toUpperCase()} support is coming in M2.` : "This file type is not previewable yet."));
  return wrapper;
}

function setLoading(path: string) {
  if (!content || !title || !subtitle) return;
  content.replaceChildren(textElement("div", "quick-look-loading", "Loading preview…"));
  title.textContent = path.split(/[\\/]/).pop() || path;
  subtitle.textContent = path;
}

function renderPreview(preview: PreviewData) {
  if (!content || !title || !subtitle) return;
  title.textContent = preview.name;
  subtitle.textContent = preview.path;
  const node = preview.kind === "directory"
    ? renderDirectory(preview)
    : preview.kind === "image"
      ? renderImage(preview)
      : preview.kind === "markdown"
        ? renderMarkdown(preview)
        : preview.kind === "text"
          ? renderText(preview)
          : preview.kind === "pdf"
            ? renderPdf(preview)
            : preview.kind === "audio" || preview.kind === "video"
              ? renderMedia(preview, preview.kind)
              : renderUnsupported(preview);
  content.replaceChildren(node);
}

async function refresh(path = selectedPath()) {
  if (!overlay || !path) return;
  openPath = path;
  const token = ++requestToken;
  setLoading(path);
  try {
    const preview = await previewEntry(path);
    if (token !== requestToken || !overlay || openPath !== path) return;
    renderPreview(preview);
  } catch (error) {
    if (token !== requestToken || !content) return;
    content.replaceChildren(textElement("div", "quick-look-error", String(error)));
  }
}

function close() {
  requestToken += 1;
  openPath = null;
  overlay?.remove();
  overlay = null;
  content = null;
  title = null;
  subtitle = null;
}

function open() {
  const path = selectedPath();
  if (!path || overlay) return;

  overlay = element("div", "quick-look-backdrop");
  const panel = element("section", "quick-look-panel");
  const header = element("header", "quick-look-header");
  const heading = element("div", "quick-look-heading");
  title = element("div", "quick-look-title");
  subtitle = element("div", "quick-look-subtitle");
  heading.append(title, subtitle);
  const closeButton = textElement("button", "quick-look-close", "Close");
  closeButton.type = "button";
  closeButton.addEventListener("click", close);
  header.append(heading, closeButton);
  content = element("div", "quick-look-content");
  const footer = element("footer", "quick-look-footer");
  footer.append(textElement("span", "", "Space to close"), textElement("span", "", "Arrow keys to browse"));
  panel.append(header, content, footer);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  void refresh(path);
}

function scheduleSelectionRefresh() {
  if (!overlay) return;
  window.setTimeout(() => {
    const path = selectedPath();
    if (path && path !== openPath) void refresh(path);
  }, 0);
}

function eventTarget(event: KeyboardEvent) {
  return event.target instanceof Element
    ? event.target
    : document.activeElement instanceof Element ? document.activeElement : null;
}

function interactiveTarget(target: Element | null) {
  return !!target?.closest("input, textarea, select, button, a[href], audio, video, iframe, [contenteditable='true']");
}

function activeFileSurfaceOwnsFocus(target: Element | null) {
  if (!target || interactiveTarget(target)) return false;
  const area = target.closest<HTMLElement>(".file-area");
  const pane = area?.closest<HTMLElement>(".explorer-pane");
  return !!area && !!pane?.classList.contains("active");
}

function toggleFromCommand(event: KeyboardEvent) {
  if (!overlay && !selectedPath()) return false;
  event.preventDefault();
  event.stopPropagation();
  if (overlay) close(); else open();
  return true;
}

function handleKeyDown(event: KeyboardEvent) {
  const target = eventTarget(event);
  if (event.code === "Space") {
    // Registry surfaces deliberately replay Space as an untrusted event. Keep
    // that explicit command path working while trusted physical Space remains
    // owned by whichever focused control the user is actually interacting with.
    if (!event.isTrusted) {
      toggleFromCommand(event);
      return;
    }
    if (overlay) {
      if (interactiveTarget(target)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!selectedPath() || !activeFileSurfaceOwnsFocus(target)) return;
    event.preventDefault();
    event.stopPropagation();
    open();
    return;
  }
  if (!overlay) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    scheduleSelectionRefresh();
  }
}

function handleClick(event: MouseEvent) {
  if (
    overlay
    && event.target instanceof Element
    && event.target.closest(".pane-file-row, .file-row")
  ) scheduleSelectionRefresh();
}

export function installQuickLook() {
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("click", handleClick, true);
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("click", handleClick, true);
    close();
  };
}

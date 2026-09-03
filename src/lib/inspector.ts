import { invoke } from "@tauri-apps/api/core";
import { actionContext, runAction } from "./actions";
import { previewEntry } from "./preview";
import type { PreviewData } from "../types";

const STORAGE_KEY = "scout:inspector-open:v1";
let panel: HTMLElement | null = null;
let appShell: HTMLElement | null = null;
let renderToken = 0;
let renderTimer: number | undefined;
let mountObserver: MutationObserver | null = null;

interface TaggedPath { path: string; tags: string[] }

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function formatDate(ms: number | null) {
  if (ms == null) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function leaf(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function section(title: string) {
  const wrapper = create("section", "inspector-section");
  const heading = create("h3", "inspector-section-title");
  heading.textContent = title;
  wrapper.append(heading);
  return wrapper;
}

function detailRow(label: string, value: string) {
  const row = create("div", "inspector-detail-row");
  const key = create("span", "inspector-detail-label");
  key.textContent = label;
  const copy = create("span", "inspector-detail-value");
  copy.textContent = value;
  copy.title = value;
  row.append(key, copy);
  return row;
}

function actionButton(title: string, actionId: string) {
  const button = create("button", "inspector-action");
  button.type = "button";
  button.textContent = title;
  button.addEventListener("click", () => void runAction(actionId).catch((error) => {
    window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message: error instanceof Error ? error.message : String(error), error: true } }));
  }));
  return button;
}

function ensureMount() {
  appShell = document.querySelector<HTMLElement>(".app-shell");
  if (!appShell) return false;
  return true;
}

function closeInspector() {
  localStorage.setItem(STORAGE_KEY, "0");
  panel?.remove();
  panel = null;
  appShell?.classList.remove("scout-inspector-open");
  renderToken += 1;
}

function buildPanel() {
  if (!ensureMount()) return null;
  panel?.remove();
  panel = create("aside", "scout-inspector");
  panel.setAttribute("aria-label", "Inspector");
  const header = create("header", "inspector-header");
  const title = create("div", "inspector-heading");
  title.textContent = "Inspector";
  const close = create("button", "inspector-close");
  close.type = "button";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close inspector");
  close.addEventListener("click", closeInspector);
  header.append(title, close);
  const body = create("div", "inspector-body");
  panel.append(header, body);
  appShell!.classList.add("scout-inspector-open");
  appShell!.append(panel);
  return body;
}

function renderEmpty(body: HTMLElement, panePath: string | null) {
  const hero = create("div", "inspector-hero");
  const name = create("strong", "inspector-name");
  name.textContent = panePath ? leaf(panePath) : "No folder open";
  const sub = create("span", "inspector-subtitle");
  sub.textContent = panePath ? "Current folder" : "Select an item to inspect it";
  hero.append(name, sub);
  body.append(hero);
  if (panePath) {
    const location = section("Location");
    location.append(detailRow("Path", panePath));
    body.append(location);
    const actions = create("div", "inspector-actions");
    actions.append(actionButton("Copy Path", "navigation.copy-folder-path"), actionButton("Bookmark", "workspace.bookmark"));
    body.append(actions);
  }
}

function renderMultiple(body: HTMLElement, names: string[]) {
  const hero = create("div", "inspector-hero");
  const name = create("strong", "inspector-name");
  name.textContent = `${names.length} items selected`;
  const sub = create("span", "inspector-subtitle");
  sub.textContent = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  hero.append(name, sub);
  body.append(hero);
  const actions = create("div", "inspector-actions");
  actions.append(actionButton("Copy Paths", "file.copy-path"), actionButton("Move to Trash", "file.trash"));
  body.append(actions);
}

function previewVisual(preview: PreviewData) {
  if (!preview.dataUrl || preview.kind !== "image") return null;
  const visual = create("div", "inspector-preview");
  const image = create("img", "inspector-preview-image");
  image.src = preview.dataUrl;
  image.alt = preview.name;
  visual.append(image);
  return visual;
}

async function hydrateSingle(body: HTMLElement, path: string, token: number) {
  let preview: PreviewData | null = null;
  let tagged: TaggedPath[] = [];
  const [previewResult, tagResult] = await Promise.allSettled([
    previewEntry(path),
    invoke<TaggedPath[]>("tags_for_paths", { paths: [path] }),
  ]);
  if (token !== renderToken || !panel?.isConnected) return;
  if (previewResult.status === "fulfilled") preview = previewResult.value;
  if (tagResult.status === "fulfilled") tagged = tagResult.value;
  if (!preview) return;

  const loading = body.querySelector(".inspector-loading");
  loading?.remove();
  const visual = previewVisual(preview);
  if (visual) body.insertBefore(visual, body.children[1] ?? null);

  const details = section("Details");
  details.append(
    detailRow("Kind", preview.kind === "unsupported" ? "File" : preview.kind[0].toUpperCase() + preview.kind.slice(1)),
    detailRow("Size", preview.kind === "directory" ? `${preview.children.length} visible items` : formatBytes(preview.size)),
    detailRow("Modified", formatDate(preview.modifiedMs)),
  );
  if (preview.extension) details.append(detailRow("Extension", preview.extension.toUpperCase()));
  if (preview.width && preview.height) details.append(detailRow("Dimensions", `${preview.width} × ${preview.height}`));
  for (const item of preview.metadata.slice(0, 10)) details.append(detailRow(item.label, item.value));
  body.append(details);

  const tags = tagged[0]?.tags ?? [];
  if (tags.length) {
    const tagSection = section("Tags");
    const chips = create("div", "inspector-tags");
    for (const tag of tags) {
      const chip = create("span", "inspector-tag");
      chip.textContent = tag;
      chips.append(chip);
    }
    tagSection.append(chips);
    body.append(tagSection);
  }
}

function renderInspector() {
  if (!panel || !panel.isConnected) return;
  const body = panel.querySelector<HTMLElement>(".inspector-body");
  if (!body) return;
  const context = actionContext();
  body.replaceChildren();
  const token = ++renderToken;

  if (!context.selection.length) {
    renderEmpty(body, context.panePath);
    return;
  }
  if (context.selection.length > 1) {
    renderMultiple(body, context.selection.map((entry) => entry.name));
    return;
  }

  const entry = context.selection[0];
  const hero = create("div", "inspector-hero");
  const name = create("strong", "inspector-name");
  name.textContent = entry.name;
  const sub = create("span", "inspector-subtitle");
  sub.textContent = entry.kind === "directory" ? "Folder" : entry.extension?.toUpperCase() || "File";
  hero.append(name, sub);
  body.append(hero);

  const location = section("Location");
  location.append(detailRow("Path", entry.path));
  body.append(location);

  const actions = create("div", "inspector-actions");
  actions.append(actionButton("Quick Look", "file.quick-look"), actionButton("Copy Path", "file.copy-path"));
  body.append(actions);

  const loading = create("div", "inspector-loading");
  loading.textContent = "Loading details…";
  body.append(loading);
  void hydrateSingle(body, entry.path, token);
}

function scheduleRender() {
  if (!panel) return;
  if (renderTimer !== undefined) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderInspector, 40);
}

function openInspector() {
  localStorage.setItem(STORAGE_KEY, "1");
  const body = buildPanel();
  if (body) renderInspector();
}

function toggleInspector() {
  if (panel?.isConnected) closeInspector();
  else openInspector();
}

function handleKeyDown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLocaleLowerCase() === "i") {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    toggleInspector();
    return;
  }
  if (panel && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(event.key)) {
    window.setTimeout(scheduleRender, 0);
  }
}

function handleToggle() {
  toggleInspector();
}

function handleInteraction() {
  scheduleRender();
}

export function installInspector() {
  window.addEventListener("scout:toggle-inspector", handleToggle);
  window.addEventListener("scout:navigate", handleInteraction);
  window.addEventListener("scout:action-ran", handleInteraction);
  window.addEventListener("pointerup", handleInteraction, true);
  window.addEventListener("keydown", handleKeyDown, true);

  if (!ensureMount()) {
    mountObserver = new MutationObserver(() => {
      if (!ensureMount()) return;
      mountObserver?.disconnect();
      mountObserver = null;
      if (localStorage.getItem(STORAGE_KEY) === "1") openInspector();
    });
    mountObserver.observe(document.body, { childList: true, subtree: true });
  } else if (localStorage.getItem(STORAGE_KEY) === "1") {
    openInspector();
  }

  return () => {
    window.removeEventListener("scout:toggle-inspector", handleToggle);
    window.removeEventListener("scout:navigate", handleInteraction);
    window.removeEventListener("scout:action-ran", handleInteraction);
    window.removeEventListener("pointerup", handleInteraction, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    mountObserver?.disconnect();
    mountObserver = null;
    if (renderTimer !== undefined) window.clearTimeout(renderTimer);
    panel?.remove();
    panel = null;
    appShell?.classList.remove("scout-inspector-open");
  };
}

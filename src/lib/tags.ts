import { invoke } from "@tauri-apps/api/core";
import { registerActions } from "./actions";
import { openEntry } from "./fs";

interface TaggedPath {
  path: string;
  tags: string[];
}

interface TagCollection {
  tag: string;
  count: number;
}

interface TaggedCollectionItem {
  path: string;
  name: string;
  kind: string;
}

let overlay: HTMLDivElement | null = null;
let sidebarSection: HTMLDivElement | null = null;
let sidebarObserver: MutationObserver | null = null;
let refreshToken = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function parseTags(value: string) {
  const tags: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const tag = raw.trim();
    if (tag && !tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) tags.push(tag);
  }
  return tags;
}

function tagHue(tag: string) {
  let hash = 0;
  for (let index = 0; index < tag.length; index += 1) hash = ((hash << 5) - hash + tag.charCodeAt(index)) | 0;
  return Math.abs(hash) % 360;
}

function tagDot(tag: string) {
  const dot = element("span", "tag-collection-dot");
  dot.style.setProperty("--tag-hue", String(tagHue(tag)));
  return dot;
}

function close() {
  overlay?.remove();
  overlay = null;
}

function emitTagsUpdated() {
  window.dispatchEvent(new CustomEvent("scout:tags-updated"));
}

function createSheet(titleText: string, subtitle?: string) {
  close();
  overlay = element("div", "utility-backdrop tag-collection-backdrop");
  const sheet = element("section", "utility-sheet tag-collection-sheet");
  const header = element("header", "utility-header");
  const heading = element("div", "tag-collection-heading");
  const title = element("div", "utility-title");
  title.textContent = titleText;
  heading.append(title);
  if (subtitle) {
    const detail = element("div", "tag-collection-subtitle");
    detail.textContent = subtitle;
    heading.append(detail);
  }
  const closeButton = element("button", "utility-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(heading, closeButton);
  const body = element("div", "utility-body tag-collection-body");
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  return body;
}

async function openTags(paths: string[]) {
  if (!paths.length) return;
  const current = await invoke<TaggedPath[]>("tags_for_paths", { paths });
  const body = createSheet(paths.length === 1 ? "Tags" : `Tags · ${paths.length} items`);

  const allTags = [...new Set(current.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));
  const list = element("div", "rename-preview");
  if (allTags.length) {
    for (const tag of allTags) {
      const row = element("div", "rename-preview-row");
      const name = element("span", "rename-after tag-editor-name");
      const count = current.filter((item) => item.tags.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())).length;
      name.append(tagDot(tag));
      const text = element("span");
      text.textContent = count === paths.length ? tag : `${tag} · ${count}/${paths.length}`;
      name.append(text);
      const remove = element("button", "utility-secondary-button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await invoke("remove_tags", { paths, tags: [tag] });
        emitTagsUpdated();
        void openTags(paths);
      });
      row.append(name, remove);
      list.append(row);
    }
  } else {
    const empty = element("div", "rename-hint");
    empty.textContent = "No Scout tags yet.";
    list.append(empty);
  }

  const field = element("label", "utility-field");
  const caption = element("span");
  caption.textContent = "Add tags";
  const input = element("input", "utility-input");
  input.placeholder = "important, invoice";
  input.spellcheck = false;
  field.append(caption, input);
  const actions = element("div", "utility-actions");
  const add = element("button", "utility-primary-button");
  add.type = "button";
  add.textContent = "Add";
  add.addEventListener("click", async () => {
    const tags = parseTags(input.value);
    if (!tags.length) return;
    add.disabled = true;
    try {
      await invoke("add_tags", { paths, tags });
      emitTagsUpdated();
      void openTags(paths);
    } finally {
      add.disabled = false;
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add.click();
    }
  });
  actions.append(add);
  body.append(list, field, actions);
  input.focus();
}

async function openTagCollection(tag: string) {
  const body = createSheet(tag, "Tagged files from anywhere on this computer");
  const loading = element("div", "rename-hint");
  loading.textContent = "Loading collection…";
  body.append(loading);

  try {
    const items = await invoke<TaggedCollectionItem[]>("paths_for_tag", { tag });
    if (!overlay) return;
    body.replaceChildren();
    const summary = element("div", "tag-collection-summary");
    summary.append(tagDot(tag));
    const summaryText = element("span");
    summaryText.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
    summary.append(summaryText);
    body.append(summary);

    if (!items.length) {
      const empty = element("div", "rename-hint");
      empty.textContent = "No existing files currently use this tag.";
      body.append(empty);
      return;
    }

    const list = element("div", "tag-collection-list");
    for (const item of items) {
      const row = element("button", "tag-collection-row");
      row.type = "button";
      row.title = item.path;
      const glyph = element("span", `tag-collection-kind ${item.kind}`);
      glyph.textContent = item.kind === "directory" ? "▸" : item.kind === "symlink" ? "↗" : "·";
      const text = element("span", "tag-collection-row-text");
      const name = element("span", "tag-collection-name");
      name.textContent = item.name;
      const path = element("span", "tag-collection-path");
      path.textContent = item.path;
      text.append(name, path);
      row.append(glyph, text);
      row.addEventListener("click", () => void openEntry(item.path));
      list.append(row);
    }
    body.append(list);
  } catch (error) {
    if (!overlay) return;
    const message = element("div", "utility-error");
    message.textContent = String(error);
    body.replaceChildren(message);
  }
}

async function openTagBrowser() {
  const body = createSheet("Tags", "Smart collections across Scout");
  try {
    const collections = await invoke<TagCollection[]>("tag_collections");
    body.replaceChildren();
    if (!collections.length) {
      const empty = element("div", "rename-hint");
      empty.textContent = "Add a tag to any file or folder and it will appear here.";
      body.append(empty);
      return;
    }
    const list = element("div", "tag-browser-list");
    for (const collection of collections) {
      const button = element("button", "tag-browser-row");
      button.type = "button";
      const name = element("span", "tag-browser-name");
      name.append(tagDot(collection.tag));
      const text = element("span");
      text.textContent = collection.tag;
      name.append(text);
      const count = element("span", "tag-browser-count");
      count.textContent = String(collection.count);
      button.append(name, count);
      button.addEventListener("click", () => void openTagCollection(collection.tag));
      list.append(button);
    }
    body.append(list);
  } catch (error) {
    const message = element("div", "utility-error");
    message.textContent = String(error);
    body.replaceChildren(message);
  }
}

async function refreshSidebar() {
  const token = ++refreshToken;
  const list = sidebarSection?.querySelector<HTMLElement>(".tag-sidebar-list");
  if (!list) return;
  try {
    const collections = await invoke<TagCollection[]>("tag_collections");
    if (token !== refreshToken || !list.isConnected) return;
    list.replaceChildren();
    if (!collections.length) {
      const empty = element("button", "tag-sidebar-empty");
      empty.type = "button";
      empty.textContent = "Add a tag…";
      empty.addEventListener("click", () => void openTagBrowser());
      list.append(empty);
      return;
    }
    for (const collection of collections.slice(0, 12)) {
      const button = element("button", "sidebar-item tag-sidebar-item");
      button.type = "button";
      button.title = `${collection.count} tagged ${collection.count === 1 ? "item" : "items"}`;
      button.append(tagDot(collection.tag));
      const label = element("span", "tag-sidebar-name");
      label.textContent = collection.tag;
      const count = element("span", "tag-sidebar-count");
      count.textContent = String(collection.count);
      button.append(label, count);
      button.addEventListener("click", () => void openTagCollection(collection.tag));
      list.append(button);
    }
    if (collections.length > 12) {
      const more = element("button", "tag-sidebar-more");
      more.type = "button";
      more.textContent = `All tags · ${collections.length}`;
      more.addEventListener("click", () => void openTagBrowser());
      list.append(more);
    }
  } catch {
    // Tags remain an optional local metadata layer; keep the sidebar quiet on DB errors.
  }
}

function installSidebarSection() {
  if (sidebarSection?.isConnected) return;
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const spacer = sidebar?.querySelector<HTMLElement>(".sidebar-spacer");
  if (!sidebar || !spacer) return;

  sidebarSection = element("div", "tag-sidebar-section");
  const header = element("div", "tag-sidebar-header");
  const title = element("span");
  title.textContent = "TAGS";
  const browse = element("button", "tag-sidebar-browse");
  browse.type = "button";
  browse.textContent = "All";
  browse.addEventListener("click", () => void openTagBrowser());
  header.append(title, browse);
  const list = element("div", "tag-sidebar-list");
  sidebarSection.append(header, list);
  sidebar.insertBefore(sidebarSection, spacer);
  void refreshSidebar();
}

function installStyles() {
  if (document.getElementById("scout-tags2-style")) return;
  const style = document.createElement("style");
  style.id = "scout-tags2-style";
  style.textContent = `
    .tag-sidebar-section { padding: 8px 8px 2px; }
    .tag-sidebar-header { display:flex; align-items:center; justify-content:space-between; padding:0 8px 5px; color:#5d5d63; font-size:9px; font-weight:650; letter-spacing:.09em; }
    .tag-sidebar-browse, .tag-sidebar-more, .tag-sidebar-empty { border:0; background:transparent; color:#73737a; font:inherit; cursor:pointer; padding:2px 0; }
    .tag-sidebar-browse:hover, .tag-sidebar-more:hover, .tag-sidebar-empty:hover { color:#c7c7cb; }
    .tag-sidebar-list { display:grid; gap:1px; }
    .tag-sidebar-item { width:100%; min-width:0; }
    .tag-sidebar-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tag-sidebar-count { margin-left:auto; color:#5f5f65; font-size:10px; font-variant-numeric:tabular-nums; }
    .tag-sidebar-more, .tag-sidebar-empty { text-align:left; padding:5px 8px; font-size:10px; }
    .tag-collection-dot { width:7px; height:7px; border-radius:999px; flex:0 0 auto; background:hsl(var(--tag-hue) 58% 58%); box-shadow:0 0 0 1px rgba(255,255,255,.06); }
    .tag-collection-sheet { width:min(620px, calc(100vw - 44px)); max-height:min(680px, calc(100vh - 56px)); }
    .tag-collection-heading { min-width:0; }
    .tag-collection-subtitle { color:#68686f; font-size:11px; margin-top:3px; }
    .tag-collection-body { min-height:120px; overflow:auto; }
    .tag-collection-summary { display:flex; align-items:center; gap:8px; color:#8d8d93; font-size:11px; padding:0 2px 9px; }
    .tag-collection-list, .tag-browser-list { display:grid; gap:2px; }
    .tag-collection-row, .tag-browser-row { width:100%; border:0; background:transparent; color:#d7d7da; display:flex; align-items:center; text-align:left; border-radius:8px; cursor:pointer; }
    .tag-collection-row { gap:10px; padding:8px 9px; }
    .tag-browser-row { justify-content:space-between; padding:8px 9px; }
    .tag-collection-row:hover, .tag-browser-row:hover { background:#1b1b1e; }
    .tag-collection-kind { width:16px; flex:0 0 16px; color:#68686f; text-align:center; font-size:12px; }
    .tag-collection-row-text { min-width:0; display:grid; gap:2px; }
    .tag-collection-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
    .tag-collection-path { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#626268; font-size:10px; }
    .tag-browser-name, .tag-editor-name { display:flex; align-items:center; gap:8px; min-width:0; }
    .tag-browser-count { color:#626268; font-size:10px; font-variant-numeric:tabular-nums; }
  `;
  document.head.append(style);
}

export function installTags() {
  installStyles();
  const unregister = registerActions([
    {
      id: "tags.edit",
      title: "Edit Tags…",
      category: "Tools",
      keywords: ["tag", "label", "organize", "metadata"],
      contextMenu: true,
      contextMenuOrder: 70,
      available: (context) => context.selectedPaths.length > 0,
      run: (context) => openTags(context.selectedPaths),
    },
    {
      id: "tags.browse",
      title: "Browse Tag Collections…",
      category: "Tools",
      keywords: ["tags", "smart collection", "sidebar", "organize", "labels"],
      available: () => true,
      run: () => openTagBrowser(),
    },
  ]);

  const handleTagsUpdated = () => void refreshSidebar();
  window.addEventListener("scout:tags-updated", handleTagsUpdated);
  sidebarObserver = new MutationObserver(installSidebarSection);
  sidebarObserver.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(installSidebarSection);

  return () => {
    unregister();
    close();
    window.removeEventListener("scout:tags-updated", handleTagsUpdated);
    sidebarObserver?.disconnect();
    sidebarObserver = null;
    sidebarSection?.remove();
    sidebarSection = null;
  };
}

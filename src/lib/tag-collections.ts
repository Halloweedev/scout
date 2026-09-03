import { invoke } from "@tauri-apps/api/core";
import { registerAction } from "./actions";
import { openEntry } from "./fs";

interface TagCollection {
  tag: string;
  count: number;
}

interface TaggedCollectionItem {
  path: string;
  name: string;
  kind: string;
}

let section: HTMLElement | null = null;
let overlay: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let pollTimer: number | undefined;
let collections: TagCollection[] = [];
let refreshToken = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function close() {
  overlay?.remove();
  overlay = null;
}

function parentPath(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return path;
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.slice(0, index);
}

function reveal(path: string) {
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: parentPath(path) } }));
  close();
}

async function activate(item: TaggedCollectionItem) {
  if (item.kind === "directory") {
    window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: item.path } }));
    close();
    return;
  }
  await openEntry(item.path);
}

function row(item: TaggedCollectionItem) {
  const wrapper = element("article", "tag-collection-item");
  const main = element("button", "tag-collection-open");
  main.type = "button";
  const icon = element("span", `tag-collection-kind ${item.kind}`);
  icon.setAttribute("aria-hidden", "true");
  const copy = element("span", "tag-collection-copy");
  const name = element("strong", "tag-collection-name");
  name.textContent = item.name;
  const path = element("span", "tag-collection-path");
  path.textContent = item.path;
  path.title = item.path;
  copy.append(name, path);
  main.append(icon, copy);
  main.addEventListener("click", () => void activate(item));
  const revealButton = element("button", "tag-collection-reveal");
  revealButton.type = "button";
  revealButton.textContent = "Reveal";
  revealButton.addEventListener("click", () => reveal(item.path));
  wrapper.append(main, revealButton);
  return wrapper;
}

async function openCollection(tag: string) {
  close();
  overlay = element("div", "tag-collection-backdrop");
  const panel = element("section", "tag-collection-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Tag ${tag}`);
  const header = element("header", "tag-collection-header");
  const heading = element("div", "tag-collection-heading");
  const title = element("h2", "tag-collection-title");
  title.textContent = tag;
  const subtitle = element("div", "tag-collection-subtitle");
  subtitle.textContent = "Scout Smart Collection";
  heading.append(title, subtitle);
  const closeButton = element("button", "tag-collection-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(heading, closeButton);
  const body = element("div", "tag-collection-body");
  const loading = element("div", "tag-collection-empty");
  loading.textContent = "Loading tagged items…";
  body.append(loading);
  panel.append(header, body);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  try {
    const items = await invoke<TaggedCollectionItem[]>("paths_for_tag", { tag });
    if (!overlay) return;
    body.replaceChildren();
    if (!items.length) {
      const empty = element("div", "tag-collection-empty");
      empty.textContent = "No existing files currently use this tag.";
      body.append(empty);
      return;
    }
    const list = element("div", "tag-collection-list");
    for (const item of items) list.append(row(item));
    body.append(list);
  } catch (error) {
    if (!overlay) return;
    const failure = element("div", "tag-collection-empty error");
    failure.textContent = error instanceof Error ? error.message : String(error);
    body.replaceChildren(failure);
  }
}

function openPicker() {
  close();
  overlay = element("div", "tag-collection-backdrop");
  const panel = element("section", "tag-collection-panel compact");
  const header = element("header", "tag-collection-header");
  const heading = element("div", "tag-collection-heading");
  const title = element("h2", "tag-collection-title");
  title.textContent = "Tags";
  const subtitle = element("div", "tag-collection-subtitle");
  subtitle.textContent = "Smart Collections";
  heading.append(title, subtitle);
  const closeButton = element("button", "tag-collection-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(heading, closeButton);
  const body = element("div", "tag-collection-body");
  if (!collections.length) {
    const empty = element("div", "tag-collection-empty");
    empty.textContent = "Add tags to files and folders to create Smart Collections.";
    body.append(empty);
  } else {
    const grid = element("div", "tag-collection-grid");
    for (const collection of collections) {
      const button = element("button", "tag-collection-card");
      button.type = "button";
      const dot = element("span", "tag-collection-dot");
      const name = element("span", "tag-collection-card-name");
      name.textContent = collection.tag;
      const count = element("span", "tag-collection-card-count");
      count.textContent = collection.count.toLocaleString();
      button.append(dot, name, count);
      button.addEventListener("click", () => void openCollection(collection.tag));
      grid.append(button);
    }
    body.append(grid);
  }
  panel.append(header, body);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
}

function mountSidebar() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebar) return;
  if (section?.isConnected) return;
  const existing = sidebar.querySelector<HTMLElement>(".tag-collections-sidebar");
  if (existing) {
    section = existing;
    renderSidebar();
    return;
  }
  section = element("section", "tag-collections-sidebar");
  const spacer = sidebar.querySelector(".sidebar-spacer");
  sidebar.insertBefore(section, spacer ?? null);
  renderSidebar();
}

function renderSidebar() {
  if (!section) return;
  section.replaceChildren();
  const heading = element("div", "sidebar-section-heading");
  const label = element("span", "sidebar-section-label");
  label.textContent = "Tags";
  const browse = element("button", "sidebar-section-action");
  browse.type = "button";
  browse.setAttribute("aria-label", "Browse tag collections");
  browse.title = "Browse tags";
  browse.textContent = "…";
  browse.addEventListener("click", openPicker);
  heading.append(label, browse);
  section.append(heading);
  if (!collections.length) {
    const empty = element("div", "workspace-empty");
    empty.textContent = "Tag files to collect them here";
    section.append(empty);
    return;
  }
  const nav = element("nav", "sidebar-nav tag-collection-sidebar-list");
  for (const collection of collections.slice(0, 8)) {
    const button = element("button", "sidebar-item tag-collection-sidebar-item");
    button.type = "button";
    button.title = `${collection.count} tagged item${collection.count === 1 ? "" : "s"}`;
    const dot = element("span", "tag-collection-sidebar-dot");
    const name = element("span");
    name.textContent = collection.tag;
    const count = element("span", "tag-collection-sidebar-count");
    count.textContent = String(collection.count);
    button.append(dot, name, count);
    button.addEventListener("click", () => void openCollection(collection.tag));
    nav.append(button);
  }
  section.append(nav);
}

async function refresh() {
  const token = ++refreshToken;
  try {
    const next = await invoke<TagCollection[]>("tag_collections");
    if (token !== refreshToken) return;
    collections = next;
    mountSidebar();
    renderSidebar();
  } catch {
    // Tags are optional metadata; browsing remains usable if the tag DB is unavailable.
  }
}

function handleTagsChanged() {
  void refresh();
}

export function installTagCollections() {
  const unregister = registerAction({
    id: "navigation.tag-collections",
    title: "Browse Tag Collections…",
    category: "Navigation",
    subtitle: "Find files and folders by Scout tag",
    keywords: ["tags", "labels", "smart collection", "favorites", "metadata"],
    run: () => openPicker(),
  });
  observer = new MutationObserver(mountSidebar);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scout:tags-changed", handleTagsChanged);
  window.addEventListener("focus", handleTagsChanged);
  pollTimer = window.setInterval(() => void refresh(), 15_000);
  mountSidebar();
  void refresh();
  return () => {
    unregister();
    observer?.disconnect();
    observer = null;
    window.removeEventListener("scout:tags-changed", handleTagsChanged);
    window.removeEventListener("focus", handleTagsChanged);
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    pollTimer = undefined;
    section?.remove();
    section = null;
    close();
  };
}

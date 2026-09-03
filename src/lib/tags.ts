import { invoke } from "@tauri-apps/api/core";
import { registerAction, type ScoutActionContext } from "./actions";

interface TaggedPath {
  path: string;
  tags: string[];
}

let overlay: HTMLDivElement | null = null;

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

function close() {
  overlay?.remove();
  overlay = null;
}

async function openTags(paths: string[]) {
  if (!paths.length) return;
  close();
  const current = await invoke<TaggedPath[]>("tags_for_paths", { paths });

  overlay = element("div", "utility-backdrop");
  const sheet = element("section", "utility-sheet");
  const header = element("header", "utility-header");
  const title = element("div", "utility-title");
  title.textContent = paths.length === 1 ? "Tags" : `Tags · ${paths.length} items`;
  const closeButton = element("button", "utility-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);

  const body = element("div", "utility-body");
  const allTags = [...new Set(current.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));
  const list = element("div", "rename-preview");
  if (allTags.length) {
    for (const tag of allTags) {
      const row = element("div", "rename-preview-row");
      const name = element("span", "rename-after");
      const count = current.filter((item) => item.tags.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())).length;
      name.textContent = count === paths.length ? tag : `${tag} · ${count}/${paths.length}`;
      const remove = element("button", "utility-secondary-button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await invoke("remove_tags", { paths, tags: [tag] });
        window.dispatchEvent(new CustomEvent("scout:tags-changed"));
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
      window.dispatchEvent(new CustomEvent("scout:tags-changed"));
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
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  input.focus();
}

function hasSelection(context: ScoutActionContext) {
  return context.selectedPaths.length > 0;
}

export function installTags() {
  const unregister = registerAction({
    id: "tools.tags",
    title: "Edit Tags…",
    category: "Tools",
    subtitle: "Add or remove Scout tags",
    keywords: ["tag", "label", "metadata", "collection"],
    contextMenu: true,
    contextMenuOrder: 48,
    available: hasSelection,
    run: (context) => openTags(context.selectedPaths),
  });
  return () => {
    unregister();
    close();
  };
}

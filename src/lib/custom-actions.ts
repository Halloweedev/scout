import { registerAction, type ScoutActionContext } from "./actions";
import { enqueueAndWait } from "./operation-queue";

const STORAGE_KEY = "scout.custom-actions.v1";

type MatchKind = "any" | "file" | "directory";

interface CustomActionDefinition {
  id: string;
  title: string;
  program: string;
  arguments: string[];
  workingDirectory: string;
  kind: MatchKind;
  extensions: string[];
  contextMenu: boolean;
  createdAt: number;
  updatedAt: number;
}

let definitions: CustomActionDefinition[] = readDefinitions();
let dynamicCleanups: Array<() => void> = [];
let managerCleanup: (() => void) | null = null;
let overlay: HTMLElement | null = null;

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function normalizeExtension(value: string) {
  return value.trim().replace(/^\./, "").toLocaleLowerCase();
}

function readDefinitions(): CustomActionDefinition[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
      .map((value) => ({
        id: typeof value.id === "string" && value.id ? value.id : id(),
        title: typeof value.title === "string" ? value.title.trim() : "",
        program: typeof value.program === "string" ? value.program.trim() : "",
        arguments: Array.isArray(value.arguments) ? value.arguments.filter((item): item is string => typeof item === "string").slice(0, 64) : [],
        workingDirectory: typeof value.workingDirectory === "string" ? value.workingDirectory : "",
        kind: value.kind === "file" || value.kind === "directory" ? value.kind : "any",
        extensions: Array.isArray(value.extensions)
          ? value.extensions.filter((item): item is string => typeof item === "string").map(normalizeExtension).filter(Boolean)
          : [],
        contextMenu: value.contextMenu !== false,
        createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
      }))
      .filter((value) => value.title && value.program)
      .slice(0, 64);
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(definitions));
  registerDynamicActions();
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function toast(message: string, error = false) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message, error } }));
}

function matches(definition: CustomActionDefinition, context: ScoutActionContext) {
  if (!context.selection.length) return false;
  return context.selection.every((entry) => {
    if (definition.kind !== "any" && entry.kind !== definition.kind) return false;
    if (!definition.extensions.length) return true;
    if (entry.kind !== "file") return false;
    return definition.extensions.includes((entry.extension ?? "").toLocaleLowerCase());
  });
}

async function runDefinition(definition: CustomActionDefinition, context: ScoutActionContext) {
  if (!matches(definition, context)) throw new Error("The current selection does not match this custom action");
  toast(`${definition.title} added to Operations`);
  await enqueueAndWait("enqueue_program_action", {
    label: definition.title,
    program: definition.program,
    arguments: definition.arguments,
    workingDirectory: definition.workingDirectory.trim() || null,
    paths: context.selectedPaths,
  });
  toast(`${definition.title} finished`);
}

function registerDynamicActions() {
  for (const cleanup of dynamicCleanups) cleanup();
  dynamicCleanups = definitions.map((definition, index) => registerAction({
    id: `custom.${definition.id}`,
    title: definition.title,
    category: "Tools",
    subtitle: "Custom Action",
    keywords: ["custom", "action", "program", definition.program, ...definition.extensions],
    contextMenu: definition.contextMenu,
    contextMenuOrder: 180 + index,
    available: (context) => matches(definition, context),
    run: (context) => runDefinition(definition, context),
  }));
}

function close() {
  overlay?.remove();
  overlay = null;
}

function field(labelText: string, input: HTMLElement, hint?: string) {
  const label = element("label", "custom-action-field");
  const title = element("span", "custom-action-field-label");
  title.textContent = labelText;
  label.append(title, input);
  if (hint) {
    const note = element("span", "custom-action-field-hint");
    note.textContent = hint;
    label.append(note);
  }
  return label;
}

function button(label: string, className = "custom-action-button") {
  const node = element("button", className);
  node.type = "button";
  node.textContent = label;
  return node;
}

function editor(existing: CustomActionDefinition | null, rerender: () => void) {
  const wrap = element("div", "custom-action-editor");
  const nameInput = element("input", "custom-action-input");
  nameInput.value = existing?.title ?? "";
  nameInput.placeholder = "Optimize with my tool";
  const programInput = element("input", "custom-action-input");
  programInput.value = existing?.program ?? "";
  programInput.placeholder = "/usr/local/bin/tool";
  const argsInput = element("textarea", "custom-action-input custom-action-arguments");
  argsInput.value = existing?.arguments.join("\n") ?? "{path}";
  argsInput.placeholder = "One argument per line";
  const workingInput = element("input", "custom-action-input");
  workingInput.value = existing?.workingDirectory ?? "";
  workingInput.placeholder = "Optional · {folder}";
  const kindSelect = element("select", "custom-action-input");
  for (const [value, label] of [["any", "Files and folders"], ["file", "Files only"], ["directory", "Folders only"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    kindSelect.append(option);
  }
  kindSelect.value = existing?.kind ?? "any";
  const extInput = element("input", "custom-action-input");
  extInput.value = existing?.extensions.join(", ") ?? "";
  extInput.placeholder = "png, jpg, webp · optional";
  const contextRow = element("label", "custom-action-check-row");
  const contextInput = element("input");
  contextInput.type = "checkbox";
  contextInput.checked = existing?.contextMenu ?? true;
  const contextText = element("span");
  contextText.textContent = "Show in context menu when applicable";
  contextRow.append(contextInput, contextText);

  wrap.append(
    field("Name", nameInput),
    field("Program", programInput, "Scout launches this executable directly. It never evaluates a shell command."),
    field("Arguments", argsInput, "One argument per line · placeholders: {path} {name} {stem} {ext} {folder}"),
    field("Working directory", workingInput, "Optional. Placeholders are supported."),
    field("Applies to", kindSelect),
    field("Extensions", extInput, "Optional comma-separated filter; leave empty for any extension."),
    contextRow,
  );

  const warning = element("div", "custom-action-warning");
  warning.textContent = "Custom Actions can modify your files because they run programs you choose. Scout passes arguments directly and does not invoke a shell.";
  wrap.append(warning);

  const actions = element("div", "custom-action-editor-actions");
  const cancel = button("Cancel");
  const save = button(existing ? "Save Changes" : "Add Action", "custom-action-button primary");
  cancel.addEventListener("click", rerender);
  save.addEventListener("click", () => {
    const title = nameInput.value.trim();
    const program = programInput.value.trim();
    if (!title || !program) {
      warning.textContent = "Name and Program are required.";
      warning.classList.add("error");
      return;
    }
    const argumentsList = argsInput.value.split("\n").map((value) => value.trim()).filter(Boolean).slice(0, 64);
    const extensions = [...new Set(extInput.value.split(/[\s,]+/).map(normalizeExtension).filter(Boolean))].slice(0, 64);
    const next: CustomActionDefinition = {
      id: existing?.id ?? id(),
      title,
      program,
      arguments: argumentsList,
      workingDirectory: workingInput.value.trim(),
      kind: kindSelect.value as MatchKind,
      extensions,
      contextMenu: contextInput.checked,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    definitions = existing
      ? definitions.map((definition) => definition.id === existing.id ? next : definition)
      : [...definitions, next].slice(0, 64);
    persist();
    rerender();
  });
  actions.append(cancel, save);
  wrap.append(actions);
  return wrap;
}

function openManager() {
  close();
  overlay = element("div", "custom-actions-backdrop");
  const panel = element("section", "custom-actions-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Custom Actions");
  const header = element("header", "custom-actions-header");
  const heading = element("div");
  const title = element("h2", "custom-actions-title");
  title.textContent = "Custom Actions";
  const subtitle = element("div", "custom-actions-subtitle");
  subtitle.textContent = "Dolphin/Nemo-style actions for Scout · available from ⌘K and context menus";
  heading.append(title, subtitle);
  const closeButton = button("Close");
  closeButton.addEventListener("click", close);
  header.append(heading, closeButton);
  const body = element("div", "custom-actions-body");
  panel.append(header, body);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);

  const renderList = () => {
    body.replaceChildren();
    const toolbar = element("div", "custom-actions-toolbar");
    const copy = element("div", "custom-actions-toolbar-copy");
    copy.textContent = definitions.length ? `${definitions.length} custom action${definitions.length === 1 ? "" : "s"}` : "Create actions for tools you already use";
    const add = button("New Action", "custom-action-button primary");
    add.addEventListener("click", () => {
      body.replaceChildren(editor(null, renderList));
    });
    toolbar.append(copy, add);
    body.append(toolbar);

    if (!definitions.length) {
      const empty = element("div", "custom-actions-empty");
      const emptyTitle = element("strong");
      emptyTitle.textContent = "No custom actions yet";
      const emptyCopy = element("span");
      emptyCopy.textContent = "Examples: run an optimizer, open a proprietary tool, upload a file, or call your own script with {path}.";
      empty.append(emptyTitle, emptyCopy);
      body.append(empty);
      return;
    }

    const list = element("div", "custom-actions-list");
    for (const definition of definitions) {
      const row = element("article", "custom-actions-row");
      const info = element("div", "custom-actions-info");
      const name = element("strong", "custom-actions-name");
      name.textContent = definition.title;
      const meta = element("span", "custom-actions-meta");
      const filter = definition.extensions.length ? ` · .${definition.extensions.join(" .")}` : "";
      meta.textContent = `${definition.program}${filter}`;
      meta.title = `${definition.program}\n${definition.arguments.join(" ")}`;
      info.append(name, meta);
      const rowActions = element("div", "custom-actions-row-actions");
      const edit = button("Edit");
      edit.addEventListener("click", () => body.replaceChildren(editor(definition, renderList)));
      const remove = button("Remove", "custom-action-button danger");
      remove.addEventListener("click", () => {
        definitions = definitions.filter((value) => value.id !== definition.id);
        persist();
        renderList();
      });
      rowActions.append(edit, remove);
      row.append(info, rowActions);
      list.append(row);
    }
    body.append(list);
  };

  renderList();
}

export function installCustomActions() {
  registerDynamicActions();
  managerCleanup = registerAction({
    id: "tools.manage-custom-actions",
    title: "Manage Custom Actions…",
    category: "Tools",
    subtitle: "Add programs and scripts to Scout's action system",
    keywords: ["custom", "actions", "extensions", "service menu", "scripts", "plugins"],
    run: () => openManager(),
  });
  return () => {
    managerCleanup?.();
    managerCleanup = null;
    for (const cleanup of dynamicCleanups) cleanup();
    dynamicCleanups = [];
    close();
  };
}

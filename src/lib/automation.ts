import { invoke } from "@tauri-apps/api/core";
import { enqueueAndWait, type OperationJob } from "./operation-queue";

type AutomationAction =
  | { type: "move"; destination: string }
  | { type: "copy"; destination: string }
  | { type: "rename"; template: string };

interface AutomationRule {
  id: number;
  name: string;
  enabled: boolean;
  folder: string;
  recursive: boolean;
  extension: string | null;
  nameContains: string | null;
  kind: "any" | "file" | "directory";
  minSize: number | null;
  maxSize: number | null;
  action: AutomationAction;
  createdMs: number;
  updatedMs: number;
}

interface AutomationMatch {
  path: string;
  name: string;
  kind: string;
  size: number | null;
}

interface AutomationPreview {
  scanned: number;
  matches: AutomationMatch[];
  truncated: boolean;
}

interface AutomationRunResult {
  ruleId: number;
  matched: number;
  affected: number;
}

interface DraftRule {
  id: number | null;
  name: string;
  enabled: boolean;
  folder: string;
  recursive: boolean;
  extension: string;
  nameContains: string;
  kind: "any" | "file" | "directory";
  minSizeMb: string;
  maxSizeMb: string;
  actionType: "move" | "copy" | "rename";
  actionValue: string;
}

let observer: MutationObserver | null = null;
let overlay: HTMLDivElement | null = null;
let rules: AutomationRule[] = [];
let selectedId: number | null = null;
let draft: DraftRule | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function activeDirectory() {
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? "";
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function bytesLabel(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function newDraft(): DraftRule {
  return {
    id: null,
    name: "New rule",
    enabled: true,
    folder: activeDirectory(),
    recursive: false,
    extension: "",
    nameContains: "",
    kind: "file",
    minSizeMb: "",
    maxSizeMb: "",
    actionType: "move",
    actionValue: "",
  };
}

function draftFromRule(rule: AutomationRule): DraftRule {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    folder: rule.folder,
    recursive: rule.recursive,
    extension: rule.extension ?? "",
    nameContains: rule.nameContains ?? "",
    kind: rule.kind,
    minSizeMb: rule.minSize == null ? "" : String(rule.minSize / (1024 * 1024)),
    maxSizeMb: rule.maxSize == null ? "" : String(rule.maxSize / (1024 * 1024)),
    actionType: rule.action.type,
    actionValue: rule.action.type === "rename" ? rule.action.template : rule.action.destination,
  };
}

function numberBytes(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 1024 * 1024);
}

function payloadFromDraft(current: DraftRule) {
  const action: AutomationAction = current.actionType === "rename"
    ? { type: "rename", template: current.actionValue }
    : { type: current.actionType, destination: current.actionValue };
  return {
    id: current.id,
    name: current.name,
    enabled: current.enabled,
    folder: current.folder,
    recursive: current.recursive,
    extension: current.extension.trim() || null,
    nameContains: current.nameContains.trim() || null,
    kind: current.kind,
    minSize: numberBytes(current.minSizeMb),
    maxSize: numberBytes(current.maxSizeMb),
    action,
  };
}

async function loadRules() {
  rules = await invoke<AutomationRule[]>("automation_rules");
}

function close() {
  overlay?.remove();
  overlay = null;
  draft = null;
}

function textField(labelText: string, value: string, onInput: (value: string) => void, placeholder = "") {
  const label = element("label", "automation-field");
  const caption = element("span", "automation-field-label");
  caption.textContent = labelText;
  const input = element("input", "automation-input");
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.addEventListener("input", () => onInput(input.value));
  label.append(caption, input);
  return label;
}

function selectField(labelText: string, value: string, options: Array<[string, string]>, onChange: (value: string) => void) {
  const label = element("label", "automation-field");
  const caption = element("span", "automation-field-label");
  caption.textContent = labelText;
  const select = element("select", "automation-select");
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    option.selected = optionValue === value;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  label.append(caption, select);
  return label;
}

function toggleField(labelText: string, checked: boolean, onChange: (checked: boolean) => void) {
  const label = element("label", "automation-toggle");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const text = element("span");
  text.textContent = labelText;
  label.append(input, text);
  return label;
}

function renderRuleList(list: HTMLElement) {
  list.replaceChildren();
  if (!rules.length) {
    const empty = element("div", "automation-list-empty");
    empty.textContent = "No rules yet.";
    list.append(empty);
    return;
  }
  for (const rule of rules) {
    const row = element("button", `automation-rule-row${rule.id === selectedId ? " selected" : ""}`);
    row.type = "button";
    const main = element("span", "automation-rule-main");
    const name = element("span", "automation-rule-name");
    name.textContent = rule.name;
    const path = element("span", "automation-rule-path");
    path.textContent = basename(rule.folder);
    main.append(name, path);
    const state = element("span", `automation-rule-state${rule.enabled ? " enabled" : ""}`);
    state.textContent = rule.enabled ? "On" : "Off";
    row.append(main, state);
    row.addEventListener("click", () => {
      selectedId = rule.id;
      draft = draftFromRule(rule);
      renderManager();
    });
    list.append(row);
  }
}

function renderPreview(target: HTMLElement, preview: AutomationPreview) {
  target.replaceChildren();
  const summary = element("div", "automation-preview-summary");
  summary.textContent = `${preview.scanned.toLocaleString()} scanned · ${preview.matches.length.toLocaleString()} shown${preview.truncated ? " · preview limited" : ""}`;
  target.append(summary);
  if (!preview.matches.length) {
    const empty = element("div", "automation-preview-empty");
    empty.textContent = "No matching items.";
    target.append(empty);
    return;
  }
  const list = element("div", "automation-preview-list");
  for (const match of preview.matches) {
    const row = element("div", "automation-preview-row");
    const info = element("span", "automation-preview-info");
    const name = element("span", "automation-preview-name");
    name.textContent = match.name;
    const path = element("span", "automation-preview-path");
    path.textContent = match.path;
    info.append(name, path);
    const meta = element("span", "automation-preview-meta");
    meta.textContent = match.kind === "file" ? bytesLabel(match.size) : "Folder";
    row.append(info, meta);
    list.append(row);
  }
  target.append(list);
}

function renderEditor(container: HTMLElement) {
  container.replaceChildren();
  const current = draft;
  if (!current) {
    const empty = element("div", "automation-editor-empty");
    empty.textContent = "Select a rule or create a new one.";
    container.append(empty);
    return;
  }

  const status = element("div", "automation-status");
  const form = element("div", "automation-form");
  form.append(
    textField("Name", current.name, (value) => { current.name = value; }),
    textField("Watch folder", current.folder, (value) => { current.folder = value; }, "/Users/…/Downloads"),
  );

  const toggles = element("div", "automation-toggle-row");
  toggles.append(
    toggleField("Enabled", current.enabled, (value) => { current.enabled = value; }),
    toggleField("Include subfolders", current.recursive, (value) => { current.recursive = value; }),
  );
  form.append(toggles);

  const conditionGrid = element("div", "automation-grid");
  conditionGrid.append(
    selectField("Kind", current.kind, [["any", "Files & folders"], ["file", "Files"], ["directory", "Folders"]], (value) => { current.kind = value as DraftRule["kind"]; }),
    textField("Extension", current.extension, (value) => { current.extension = value; }, "pdf"),
    textField("Name contains", current.nameContains, (value) => { current.nameContains = value; }, "invoice"),
    textField("Min size (MB)", current.minSizeMb, (value) => { current.minSizeMb = value; }, "optional"),
    textField("Max size (MB)", current.maxSizeMb, (value) => { current.maxSizeMb = value; }, "optional"),
  );
  form.append(conditionGrid);

  const actionGrid = element("div", "automation-action-grid");
  const actionSelect = selectField(
    "Action",
    current.actionType,
    [["move", "Move to folder"], ["copy", "Copy to folder"], ["rename", "Rename"]],
    (value) => {
      current.actionType = value as DraftRule["actionType"];
      current.actionValue = current.actionType === "rename" ? "{stem}-sorted.{ext}" : "";
      renderManager();
    },
  );
  const actionValue = textField(
    current.actionType === "rename" ? "Rename template" : "Destination folder",
    current.actionValue,
    (value) => { current.actionValue = value; },
    current.actionType === "rename" ? "{stem}-sorted.{ext}" : "/Users/…/Archive",
  );
  actionGrid.append(actionSelect, actionValue);
  form.append(actionGrid);

  const hint = element("div", "automation-hint");
  hint.textContent = current.actionType === "rename"
    ? "Rename placeholders: {name}, {stem}, {ext}, {n}."
    : "For safety, destinations inside the watched folder are blocked to prevent self-trigger loops.";
  form.append(hint);

  const preview = element("div", "automation-preview");
  const actions = element("div", "automation-actions");
  const save = element("button", "automation-primary");
  save.type = "button";
  save.textContent = current.id == null ? "Create rule" : "Save changes";
  save.addEventListener("click", async () => {
    save.disabled = true;
    status.textContent = "Saving…";
    try {
      const saved = await invoke<AutomationRule>("save_automation_rule", { input: payloadFromDraft(current) });
      await loadRules();
      selectedId = saved.id;
      draft = draftFromRule(saved);
      renderManager();
    } catch (error) {
      status.textContent = String(error);
      save.disabled = false;
    }
  });
  actions.append(save);

  if (current.id != null) {
    const dryRun = element("button", "automation-secondary");
    dryRun.type = "button";
    dryRun.textContent = "Dry run";
    dryRun.addEventListener("click", async () => {
      dryRun.disabled = true;
      status.textContent = "Scanning without making changes…";
      try {
        const result = await invoke<AutomationPreview>("preview_automation_rule", { id: current.id });
        status.textContent = "Dry run complete";
        renderPreview(preview, result);
      } catch (error) {
        status.textContent = String(error);
      } finally {
        dryRun.disabled = false;
      }
    });

    const run = element("button", "automation-secondary");
    run.type = "button";
    run.textContent = "Run now";
    run.addEventListener("click", async () => {
      run.disabled = true;
      status.textContent = "Added to Operations…";
      try {
        const result = await enqueueAndWait<AutomationRunResult>("enqueue_automation_rule", { id: current.id }, (job: OperationJob<AutomationRunResult>) => {
          if (!overlay) return;
          status.textContent = job.detail ?? (job.status === "queued" ? "Queued…" : "Running…");
        });
        if (!overlay) return;
        status.textContent = `Done · ${result.affected}/${result.matched} matches processed`;
      } catch (error) {
        if (overlay) status.textContent = String(error);
      } finally {
        if (run.isConnected) run.disabled = false;
      }
    });

    const remove = element("button", "automation-danger");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await invoke<void>("delete_automation_rule", { id: current.id });
        await loadRules();
        selectedId = rules[0]?.id ?? null;
        draft = rules[0] ? draftFromRule(rules[0]) : null;
        renderManager();
      } catch (error) {
        status.textContent = String(error);
        remove.disabled = false;
      }
    });
    actions.append(dryRun, run, remove);
  }

  container.append(form, actions, status, preview);
}

function renderManager() {
  if (!overlay) return;
  const list = overlay.querySelector<HTMLElement>(".automation-rule-list");
  const editor = overlay.querySelector<HTMLElement>(".automation-editor");
  if (list) renderRuleList(list);
  if (editor) renderEditor(editor);
}

async function openManager() {
  close();
  await loadRules();
  selectedId = rules[0]?.id ?? null;
  draft = rules[0] ? draftFromRule(rules[0]) : null;

  overlay = element("div", "automation-backdrop");
  const sheet = element("section", "automation-sheet");
  const header = element("header", "automation-header");
  const heading = element("div");
  const title = element("div", "automation-title");
  title.textContent = "Automation";
  const subtitle = element("div", "automation-subtitle");
  subtitle.textContent = "Local rules · dry-run first · manual execution through Operations";
  heading.append(title, subtitle);
  const headerActions = element("div", "automation-header-actions");
  const add = element("button", "automation-header-button");
  add.type = "button";
  add.textContent = "New rule";
  add.addEventListener("click", () => {
    selectedId = null;
    draft = newDraft();
    renderManager();
  });
  const closeButton = element("button", "automation-header-button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  headerActions.append(add, closeButton);
  header.append(heading, headerActions);

  const body = element("div", "automation-body");
  const list = element("aside", "automation-rule-list");
  const editor = element("main", "automation-editor");
  body.append(list, editor);
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  renderManager();
}

function ensureSidebarButton() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebar || sidebar.querySelector(".automation-sidebar")) return;
  const section = element("div", "automation-sidebar");
  const label = element("div", "sidebar-section-label");
  label.textContent = "Power";
  const nav = element("nav", "sidebar-nav");
  const button = element("button", "sidebar-item");
  button.type = "button";
  const name = element("span");
  name.textContent = "Automation";
  const count = element("span", "automation-sidebar-count");
  count.textContent = rules.length ? String(rules.length) : "";
  button.append(name, count);
  button.addEventListener("click", () => void openManager());
  nav.append(button);
  section.append(label, nav);
  sidebar.append(section);
}

async function refreshSidebar() {
  try {
    await loadRules();
    ensureSidebarButton();
    const count = document.querySelector<HTMLElement>(".automation-sidebar-count");
    if (count) count.textContent = rules.length ? String(rules.length) : "";
  } catch {
    // Keep Scout usable if automation storage is temporarily unavailable.
  }
}

export function installAutomation() {
  observer = new MutationObserver(ensureSidebarButton);
  observer.observe(document.body, { childList: true, subtree: true });
  void refreshSidebar();
  return () => {
    observer?.disconnect();
    observer = null;
    close();
  };
}

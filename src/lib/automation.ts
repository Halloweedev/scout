import { invoke } from "@tauri-apps/api/core";
import { enqueueAndWait, type OperationJob } from "./operation-queue";

type ImageFormat = "jpg" | "png" | "webp";
type ConverterEngine = "ffmpeg" | "pandoc" | "libreoffice";
type AutomationAction =
  | { type: "move"; destination: string }
  | { type: "copy"; destination: string }
  | { type: "rename"; template: string }
  | { type: "archive"; destination: string }
  | { type: "image"; destination: string; format: ImageFormat; maxWidth: number | null; maxHeight: number | null; quality: number | null }
  | { type: "convert"; engine: ConverterEngine; destination: string; target: string }
  | { type: "script"; program: string; arguments: string[]; workingDirectory: string | null };

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

const INTERNAL_TAG_PROGRAM = "@scout/tag";
type ActionType = AutomationAction["type"] | "tag";

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
  actionType: ActionType;
  actionValue: string;
  imageFormat: ImageFormat;
  imageMaxWidth: string;
  imageMaxHeight: string;
  imageQuality: string;
  converterEngine: ConverterEngine;
  converterTarget: string;
  scriptProgram: string;
  scriptArguments: string;
  scriptWorkingDirectory: string;
  tagNames: string;
}

const CONVERTER_TARGETS: Record<ConverterEngine, Array<[string, string]>> = {
  ffmpeg: [["mp4", "MP4"], ["webm", "WebM"], ["mp3", "MP3"], ["m4a", "M4A"], ["wav", "WAV"], ["gif", "GIF"]],
  pandoc: [["html", "HTML"], ["docx", "DOCX"], ["odt", "ODT"], ["rtf", "RTF"], ["epub", "EPUB"], ["md", "Markdown"], ["txt", "Text"]],
  libreoffice: [["pdf", "PDF"], ["docx", "DOCX"], ["odt", "ODT"], ["xlsx", "XLSX"], ["csv", "CSV"], ["pptx", "PPTX"]],
};

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

function isInternalTagAction(action: AutomationAction) {
  return action.type === "script" && action.program === INTERNAL_TAG_PROGRAM;
}

function parseTags(value: string) {
  const tags: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const tag = raw.trim();
    if (tag && !tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) tags.push(tag);
  }
  return tags;
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
    imageFormat: "webp",
    imageMaxWidth: "",
    imageMaxHeight: "",
    imageQuality: "88",
    converterEngine: "ffmpeg",
    converterTarget: "mp4",
    scriptProgram: "",
    scriptArguments: "{path}",
    scriptWorkingDirectory: "",
    tagNames: "",
  };
}

function actionDestination(action: AutomationAction) {
  switch (action.type) {
    case "move":
    case "copy":
    case "archive":
    case "image":
    case "convert":
      return action.destination;
    default:
      return "";
  }
}

function draftFromRule(rule: AutomationRule): DraftRule {
  const tagAction = isInternalTagAction(rule.action);
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
    actionType: tagAction ? "tag" : rule.action.type,
    actionValue: rule.action.type === "rename" ? rule.action.template : actionDestination(rule.action),
    imageFormat: rule.action.type === "image" ? rule.action.format : "webp",
    imageMaxWidth: rule.action.type === "image" && rule.action.maxWidth != null ? String(rule.action.maxWidth) : "",
    imageMaxHeight: rule.action.type === "image" && rule.action.maxHeight != null ? String(rule.action.maxHeight) : "",
    imageQuality: rule.action.type === "image" && rule.action.quality != null ? String(rule.action.quality) : "88",
    converterEngine: rule.action.type === "convert" ? rule.action.engine : "ffmpeg",
    converterTarget: rule.action.type === "convert" ? rule.action.target : "mp4",
    scriptProgram: rule.action.type === "script" && !tagAction ? rule.action.program : "",
    scriptArguments: rule.action.type === "script" && !tagAction ? rule.action.arguments.join("\n") : "{path}",
    scriptWorkingDirectory: rule.action.type === "script" && !tagAction ? rule.action.workingDirectory ?? "" : "",
    tagNames: rule.action.type === "script" && tagAction ? rule.action.arguments.join(", ") : "",
  };
}

function numberBytes(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 1024 * 1024);
}

function positiveInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function imageQuality(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.round(parsed))) : 88;
}

function payloadFromDraft(current: DraftRule) {
  let action: AutomationAction;
  if (current.actionType === "rename") {
    action = { type: "rename", template: current.actionValue };
  } else if (current.actionType === "image") {
    action = {
      type: "image",
      destination: current.actionValue,
      format: current.imageFormat,
      maxWidth: positiveInteger(current.imageMaxWidth),
      maxHeight: positiveInteger(current.imageMaxHeight),
      quality: imageQuality(current.imageQuality),
    };
  } else if (current.actionType === "convert") {
    action = {
      type: "convert",
      engine: current.converterEngine,
      destination: current.actionValue,
      target: current.converterTarget,
    };
  } else if (current.actionType === "script") {
    action = {
      type: "script",
      program: current.scriptProgram,
      arguments: current.scriptArguments.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      workingDirectory: current.scriptWorkingDirectory.trim() || null,
    };
  } else if (current.actionType === "tag") {
    action = {
      type: "script",
      program: INTERNAL_TAG_PROGRAM,
      arguments: parseTags(current.tagNames),
      workingDirectory: null,
    };
  } else {
    action = { type: current.actionType, destination: current.actionValue };
  }
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

function textareaField(labelText: string, value: string, onInput: (value: string) => void, placeholder = "") {
  const label = element("label", "automation-field");
  const caption = element("span", "automation-field-label");
  caption.textContent = labelText;
  const input = element("textarea", "automation-input");
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.rows = 4;
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
    [["move", "Move to folder"], ["copy", "Copy to folder"], ["rename", "Rename"], ["tag", "Add tags"], ["archive", "Archive to ZIP"], ["image", "Optimize / convert image"], ["convert", "Convert media / document"], ["script", "Run program / script"]],
    (value) => {
      current.actionType = value as DraftRule["actionType"];
      if (current.actionType === "rename") current.actionValue = "{stem}-sorted.{ext}";
      else current.actionValue = "";
      if (current.actionType === "image" || current.actionType === "convert") current.kind = "file";
      renderManager();
    },
  );
  actionGrid.append(actionSelect);
  if (current.actionType !== "script" && current.actionType !== "tag") {
    const actionValue = textField(
      current.actionType === "rename" ? "Rename template" : "Destination folder",
      current.actionValue,
      (value) => { current.actionValue = value; },
      current.actionType === "rename" ? "{stem}-sorted.{ext}" : "/Users/…/Archive",
    );
    actionGrid.append(actionValue);
  }
  form.append(actionGrid);

  if (current.actionType === "tag") {
    form.append(textField("Tags", current.tagNames, (value) => { current.tagNames = value; }, "important, invoice"));
  }

  if (current.actionType === "image") {
    const imageGrid = element("div", "automation-grid");
    imageGrid.append(
      selectField("Output format", current.imageFormat, [["webp", "WebP"], ["jpg", "JPEG"], ["png", "PNG"]], (value) => { current.imageFormat = value as ImageFormat; }),
      textField("Max width", current.imageMaxWidth, (value) => { current.imageMaxWidth = value; }, "Original"),
      textField("Max height", current.imageMaxHeight, (value) => { current.imageMaxHeight = value; }, "Original"),
      textField("JPEG quality", current.imageQuality, (value) => { current.imageQuality = value; }, "88"),
    );
    form.append(imageGrid);
  }

  if (current.actionType === "convert") {
    const conversionGrid = element("div", "automation-grid");
    conversionGrid.append(
      selectField("Engine", current.converterEngine, [["ffmpeg", "FFmpeg"], ["pandoc", "Pandoc"], ["libreoffice", "LibreOffice"]], (value) => {
        current.converterEngine = value as ConverterEngine;
        current.converterTarget = CONVERTER_TARGETS[current.converterEngine][0][0];
        renderManager();
      }),
      selectField("Output format", current.converterTarget, CONVERTER_TARGETS[current.converterEngine], (value) => { current.converterTarget = value; }),
    );
    form.append(conversionGrid);
  }

  if (current.actionType === "script") {
    const scriptGrid = element("div", "automation-grid");
    scriptGrid.append(
      textField("Program", current.scriptProgram, (value) => { current.scriptProgram = value; }, "/usr/local/bin/my-script"),
      textField("Working directory", current.scriptWorkingDirectory, (value) => { current.scriptWorkingDirectory = value; }, "optional"),
    );
    form.append(scriptGrid);
    form.append(textareaField("Arguments · one per line", current.scriptArguments, (value) => { current.scriptArguments = value; }, "{path}"));
  }

  const hint = element("div", "automation-hint");
  if (current.actionType === "rename") {
    hint.textContent = "Rename placeholders: {name}, {stem}, {ext}, {n}.";
  } else if (current.actionType === "tag") {
    hint.textContent = "Tags are stored locally by Scout and work on files or folders across macOS, Windows, and Linux. Separate tags with commas.";
  } else if (current.actionType === "image") {
    hint.textContent = "Image rules require files. Outputs are created outside the watched folder through Scout’s cancellable image engine.";
  } else if (current.actionType === "archive") {
    hint.textContent = "Each matching item becomes its own ZIP in the destination folder. The destination must be outside the watched tree.";
  } else if (current.actionType === "convert") {
    hint.textContent = `${current.converterEngine === "ffmpeg" ? "FFmpeg" : current.converterEngine === "pandoc" ? "Pandoc" : "LibreOffice"} must be installed locally. Scout kills the process if the Operations job is cancelled.`;
  } else if (current.actionType === "script") {
    hint.textContent = "Scout launches the program directly, never through a shell. Argument placeholders: {path}, {name}, {stem}, {ext}, {folder}. Cancelling the job kills the child process.";
  } else {
    hint.textContent = "For safety, destinations inside the watched folder are blocked to prevent self-trigger loops.";
  }
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
  subtitle.textContent = "Local rules · dry runs · live triggers through Operations";
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

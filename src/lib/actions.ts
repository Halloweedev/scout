export type ScoutActionCategory = "File" | "Navigation" | "Selection" | "Tabs" | "View" | "Tools" | "Workspace" | "Developer";

export interface ScoutActionEntry {
  path: string;
  name: string;
  kind: string;
  extension: string | null;
  gitState?: string;
}

export interface ScoutActionContext {
  panePath: string | null;
  selection: ScoutActionEntry[];
  selectedPaths: string[];
  tabCount: number;
  hasActiveTab: boolean;
  clipboardCount?: number;
}

export type ScoutActionResult = void | boolean | Promise<void | boolean>;

export interface ScoutAction {
  id: string;
  title: string;
  category: ScoutActionCategory;
  subtitle?: string;
  keywords?: string[];
  shortcut?: string;
  contextMenu?: boolean;
  contextMenuOrder?: number;
  danger?: boolean;
  available?: (context: ScoutActionContext) => boolean;
  run: (context: ScoutActionContext) => ScoutActionResult;
}

const actions = new Map<string, ScoutAction>();
const listeners = new Set<() => void>();
const CONTEXT_MENU_CATEGORY_ORDER: ScoutActionCategory[] = [
  "File",
  "Navigation",
  "Tabs",
  "Selection",
  "Tools",
  "Workspace",
  "Developer",
  "View",
];
// App.tsx still owns a few native context-menu rows whose behavior is tightly
// coupled to the current pane. Keep those actions discoverable elsewhere while
// preventing the registry augmentation layer from rendering a second copy.
const APP_OWNED_CONTEXT_MENU_ACTIONS = new Set(["file.open-new-tab"]);
let observer: MutationObserver | null = null;
let reconcileQueued = false;

function rowEntry(row: HTMLElement): ScoutActionEntry | null {
  const path = row.dataset.entryPath;
  if (!path) return null;
  return {
    path,
    name: row.dataset.entryName || path.split(/[\\/]/).filter(Boolean).at(-1) || path,
    kind: row.dataset.entryKind || "other",
    extension: row.dataset.entryExtension || null,
    gitState: row.dataset.gitState || undefined,
  };
}

function contextMenuCategoryRank(category: ScoutActionCategory) {
  const index = CONTEXT_MENU_CATEGORY_ORDER.indexOf(category);
  return index < 0 ? CONTEXT_MENU_CATEGORY_ORDER.length : index;
}

function clipboardCountFromApp() {
  for (const item of document.querySelectorAll<HTMLElement>(".statusbar > span")) {
    const match = /^(?:Copied|Cut)\s+(\d+)$/.exec(item.textContent?.trim() ?? "");
    if (!match) continue;
    const count = Number.parseInt(match[1], 10);
    return Number.isFinite(count) ? count : 0;
  }
  return 0;
}

export function actionContext(): ScoutActionContext {
  const pane = document.querySelector<HTMLElement>(".explorer-pane.active");
  const selection = pane
    ? [...pane.querySelectorAll<HTMLElement>(".pane-file-row.selected")].map(rowEntry).filter((entry): entry is ScoutActionEntry => !!entry)
    : [];
  return {
    panePath: pane?.dataset.panePath ?? null,
    selection,
    selectedPaths: selection.map((entry) => entry.path),
    tabCount: document.querySelectorAll(".tab").length,
    hasActiveTab: !!document.querySelector(".tab.active"),
    clipboardCount: clipboardCountFromApp(),
  };
}

export function registerAction(action: ScoutAction) {
  if (actions.has(action.id)) throw new Error(`Scout action already registered: ${action.id}`);
  actions.set(action.id, action);
  for (const listener of listeners) listener();
  queueReconcile();
  return () => unregisterAction(action.id);
}

export function registerActions(next: ScoutAction[]) {
  const cleanups = next.map(registerAction);
  return () => cleanups.reverse().forEach((cleanup) => cleanup());
}

export function unregisterAction(id: string) {
  if (!actions.delete(id)) return;
  for (const listener of listeners) listener();
  queueReconcile();
}

export function allActions() {
  return [...actions.values()];
}

export function availableActions(context = actionContext()) {
  return allActions().filter((action) => !action.available || action.available(context));
}

export async function runAction(id: string, context = actionContext()) {
  const action = actions.get(id);
  if (!action) throw new Error(`Unknown Scout action: ${id}`);
  if (action.available && !action.available(context)) throw new Error(`${action.title} is not available here`);
  await action.run(context);
  window.dispatchEvent(new CustomEvent("scout:action-ran", { detail: { id } }));
}

export function onActionsChanged(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function enhanceContextMenu(menu: HTMLElement) {
  const context = actionContext();
  const contextual = availableActions(context)
    .filter((action) => action.contextMenu && !APP_OWNED_CONTEXT_MENU_ACTIONS.has(action.id))
    .sort((a, b) => contextMenuCategoryRank(a.category) - contextMenuCategoryRank(b.category)
      || (a.contextMenuOrder ?? 100) - (b.contextMenuOrder ?? 100)
      || a.title.localeCompare(b.title));

  menu.querySelectorAll("[data-scout-action-registry]").forEach((node) => node.remove());
  if (!contextual.length) return;

  const separator = document.createElement("div");
  separator.className = "menu-separator";
  separator.dataset.scoutActionRegistry = "1";
  separator.setAttribute("role", "separator");
  menu.append(separator);

  let previousCategory: ScoutActionCategory | null = null;
  for (const action of contextual) {
    if (action.category !== previousCategory) {
      const heading = document.createElement("div");
      heading.className = "contextual-action-menu-heading";
      heading.dataset.scoutActionRegistry = "1";
      heading.setAttribute("role", "presentation");
      heading.textContent = action.category;
      menu.append(heading);
      previousCategory = action.category;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scoutActionRegistry = "1";
    button.dataset.scoutActionId = action.id;
    if (action.danger) button.classList.add("danger");
    const label = document.createElement("span");
    label.textContent = action.title;
    button.append(label);
    if (action.shortcut) {
      const shortcut = document.createElement("kbd");
      shortcut.textContent = action.shortcut;
      button.append(shortcut);
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.remove();
      void runAction(action.id, context).catch((error) => {
        window.dispatchEvent(new CustomEvent("scout:action-error", { detail: { message: error instanceof Error ? error.message : String(error) } }));
      });
    });
    menu.append(button);
  }
}

function reconcileMenus() {
  reconcileQueued = false;
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceContextMenu(menu);
  // Rebuilding the registry-owned section mutates the observed menu. Discard
  // those records so the registry doesn't schedule a second identical pass.
  observer?.takeRecords();
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcileMenus);
}

export function installActionRegistry() {
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer?.disconnect();
    observer = null;
    listeners.clear();
    actions.clear();
  };
}

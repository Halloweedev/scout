export type ScoutActionCategory = "File" | "Navigation" | "Selection" | "Tabs" | "View" | "Tools" | "Workspace";

export interface ScoutActionEntry {
  path: string;
  name: string;
  kind: string;
  extension: string | null;
}

export interface ScoutActionContext {
  panePath: string | null;
  selection: ScoutActionEntry[];
  selectedPaths: string[];
  tabCount: number;
  hasActiveTab: boolean;
}

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
  run: (context: ScoutActionContext) => void | Promise<void>;
}

const actions = new Map<string, ScoutAction>();
const listeners = new Set<() => void>();
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
  };
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
    .filter((action) => action.contextMenu)
    .sort((a, b) => (a.contextMenuOrder ?? 100) - (b.contextMenuOrder ?? 100) || a.title.localeCompare(b.title));

  menu.querySelectorAll("[data-scout-action-registry]").forEach((node) => node.remove());
  if (!contextual.length) return;

  const separator = document.createElement("div");
  separator.className = "menu-separator";
  separator.dataset.scoutActionRegistry = "1";
  menu.append(separator);

  for (const action of contextual) {
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

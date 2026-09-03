import { availableActions, runAction, type ScoutAction, type ScoutActionContext } from "./actions";
import { installContextualActions } from "./contextual-actions";

const MENU_LAYOUT: Array<string | "separator"> = [
  "file.new-folder",
  "clipboard.paste",
  "selection.all",
  "separator",
  "navigation.copy-folder-path",
  "workspace.bookmark",
];

let menu: HTMLDivElement | null = null;

function closeMenu() {
  menu?.remove();
  menu = null;
}

function contextFor(area: HTMLElement): ScoutActionContext | null {
  const pane = area.closest<HTMLElement>(".explorer-pane[data-pane-path]");
  const panePath = pane?.dataset.panePath ?? null;
  if (!pane || !panePath) return null;
  return {
    panePath,
    selection: [],
    selectedPaths: [],
    tabCount: document.querySelectorAll(".tab-strip > .tab").length,
    hasActiveTab: !!document.querySelector(".tab-strip > .tab.active"),
  };
}

function actionMap(context: ScoutActionContext) {
  return new Map(availableActions(context).map((action) => [action.id, action]));
}

function appendAction(node: HTMLDivElement, action: ScoutAction, context: ScoutActionContext) {
  const button = document.createElement("button");
  button.type = "button";
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
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    void runAction(action.id, context).catch((error) => {
      window.dispatchEvent(new CustomEvent("scout:action-error", {
        detail: { message: error instanceof Error ? error.message : String(error) },
      }));
    });
  });
  node.append(button);
}

function showMenu(area: HTMLElement, x: number, y: number) {
  const context = contextFor(area);
  if (!context) return;
  const actions = actionMap(context);
  closeMenu();

  const node = document.createElement("div");
  node.className = "context-menu glass-surface scout-background-context-menu";
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.setAttribute("aria-label", "Folder actions");

  let pendingSeparator = false;
  let hasAction = false;
  for (const item of MENU_LAYOUT) {
    if (item === "separator") {
      pendingSeparator = hasAction;
      continue;
    }
    const action = actions.get(item);
    if (!action) continue;
    if (pendingSeparator && node.children.length > 0) {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      separator.setAttribute("role", "separator");
      node.append(separator);
    }
    pendingSeparator = false;
    appendAction(node, action, context);
    hasAction = true;
  }

  if (!hasAction) return;
  document.body.append(node);
  menu = node;
}

function backgroundArea(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const area = target.closest<HTMLElement>(".explorer-pane .file-area");
  if (!area) return null;
  if (target.closest(".pane-file-row, .file-header, button, input, textarea, select, a, [contenteditable='true'], .column-browser-row")) return null;
  return area;
}

function handleContextMenu(event: MouseEvent) {
  const area = backgroundArea(event.target);
  if (!area) return;
  event.preventDefault();
  event.stopPropagation();

  // Reuse Scout's normal empty-area click contract so the pane becomes active
  // and any stale item selection is cleared before folder-level actions run.
  area.click();
  showMenu(area, event.clientX, event.clientY);
}

function handlePointerDown(event: PointerEvent) {
  if (!menu) return;
  if (event.target instanceof Node && menu.contains(event.target)) return;
  closeMenu();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !menu) return;
  closeMenu();
}

function handleBlur() {
  closeMenu();
}

export function installBackgroundContextMenu() {
  const contextualActionsCleanup = installContextualActions();
  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("blur", handleBlur);

  return () => {
    contextualActionsCleanup();
    closeMenu();
    document.removeEventListener("contextmenu", handleContextMenu, true);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("blur", handleBlur);
  };
}

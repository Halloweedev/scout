import "../contextual-actions.css";
import {
  actionContext,
  availableActions,
  onActionsChanged,
  runAction,
  type ScoutAction,
  type ScoutActionCategory,
  type ScoutActionContext,
} from "./actions";
import { openCommandPalette } from "./command-palette";

const QUICK_SINGLE = [
  "file.open",
  "file.quick-look",
  "file.rename",
  "file.copy-path",
  "file.trash",
];

const QUICK_MULTI = [
  "file.quick-look",
  "file.folder-with-selection",
  "file.duplicate",
  "file.copy-path",
  "file.trash",
];

const CONTEXT_CATEGORIES = new Set<ScoutActionCategory>(["File", "Selection", "Tools", "Developer"]);
const CATEGORY_ORDER: ScoutActionCategory[] = ["File", "Selection", "Tools", "Developer"];
const SHORT_LABELS: Record<string, string> = {
  "file.quick-look": "Quick Look",
  "file.open-new-tab": "New Tab",
  "file.copy-path": "Copy Path",
  "file.folder-with-selection": "Group",
  "file.duplicate": "Duplicate",
  "file.trash": "Trash",
};

let bar: HTMLDivElement | null = null;
let menu: HTMLDivElement | null = null;
let observer: MutationObserver | null = null;
let syncQueued = false;
let lastSignature = "";
let stopActionsChanged: (() => void) | null = null;
let menuContext: ScoutActionContext | null = null;

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function selectionLabel(context: ScoutActionContext) {
  if (context.selection.length === 1) return context.selection[0].name || "1 selected";
  return `${context.selectedPaths.length} selected`;
}

function categoryRank(category: ScoutActionCategory) {
  const index = CATEGORY_ORDER.indexOf(category);
  return index < 0 ? CATEGORY_ORDER.length : index;
}

function contextualActions(context: ScoutActionContext) {
  if (!context.selectedPaths.length) return [];
  return availableActions(context)
    .filter((action) => {
      if (!CONTEXT_CATEGORIES.has(action.category)) return false;
      if (action.contextMenu) return true;
      if (QUICK_SINGLE.includes(action.id) || QUICK_MULTI.includes(action.id)) return true;
      return action.category === "Tools" || action.category === "Developer";
    })
    .sort((a, b) => {
      if (a.danger !== b.danger) return a.danger ? 1 : -1;
      return categoryRank(a.category) - categoryRank(b.category)
        || (a.contextMenuOrder ?? 100) - (b.contextMenuOrder ?? 100)
        || a.title.localeCompare(b.title);
    });
}

function quickActions(context: ScoutActionContext, actions: ScoutAction[]) {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const preferred = context.selectedPaths.length > 1 ? QUICK_MULTI : QUICK_SINGLE;
  const result = preferred.map((id) => byId.get(id)).filter((action): action is ScoutAction => !!action);

  if (result.length < 5) {
    for (const action of actions) {
      if (result.includes(action) || action.danger) continue;
      result.push(action);
      if (result.length >= 5) break;
    }
  }
  return result.slice(0, 5);
}

function actionTitle(action: ScoutAction) {
  return SHORT_LABELS[action.id] ?? action.title;
}

function dispatchActionError(error: unknown) {
  window.dispatchEvent(new CustomEvent("scout:action-error", {
    detail: { message: error instanceof Error ? error.message : String(error) },
  }));
}

async function execute(action: ScoutAction, context: ScoutActionContext) {
  closeMenu();
  try {
    await runAction(action.id, context);
  } catch (error) {
    dispatchActionError(error);
  } finally {
    queueSync();
  }
}

function actionButton(action: ScoutAction, context: ScoutActionContext, compact = false) {
  const button = create("button", compact ? "contextual-action-button" : "contextual-action-menu-item");
  button.type = "button";
  button.dataset.scoutActionId = action.id;
  if (action.danger) button.classList.add("danger");
  button.title = action.shortcut ? `${action.title} · ${action.shortcut}` : action.title;

  const label = create("span", compact ? "contextual-action-button-label" : "contextual-action-menu-title");
  label.textContent = compact ? actionTitle(action) : action.title;
  button.append(label);

  if (!compact && action.shortcut) {
    const shortcut = create("kbd", "contextual-action-shortcut");
    shortcut.textContent = action.shortcut;
    button.append(shortcut);
  }

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void execute(action, context);
  });
  return button;
}

function ensureBar() {
  if (!bar) {
    bar = create("div", "contextual-action-bar");
    bar.setAttribute("aria-label", "Selection actions");
  }
  if (bar.isConnected) return bar;
  const toolbar = document.querySelector<HTMLElement>(".workspace > .toolbar");
  if (!toolbar?.parentElement) return bar;
  toolbar.insertAdjacentElement("afterend", bar);
  return bar;
}

function closeMenu() {
  menu?.remove();
  menu = null;
  menuContext = null;
}

function menuButtons() {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
}

function focusMenuButton(index: number) {
  const buttons = menuButtons();
  if (!buttons.length) return;
  const normalized = (index + buttons.length) % buttons.length;
  buttons.forEach((button, buttonIndex) => { button.tabIndex = buttonIndex === normalized ? 0 : -1; });
  buttons[normalized]?.focus({ preventScroll: true });
}

function positionMenu(anchor: HTMLElement) {
  if (!menu) return;
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(margin, rect.right - menuRect.width),
    Math.max(margin, window.innerWidth - menuRect.width - margin),
  );
  const top = Math.min(rect.bottom + 6, Math.max(margin, window.innerHeight - menuRect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openMenu(anchor: HTMLElement, context: ScoutActionContext, actions: ScoutAction[]) {
  closeMenu();
  const node = create("div", "contextual-action-menu glass-surface");
  node.setAttribute("role", "menu");
  node.setAttribute("aria-label", "Available selection actions");
  menu = node;
  menuContext = context;

  let previousCategory: ScoutActionCategory | null = null;
  for (const action of actions) {
    if (action.category !== previousCategory) {
      const heading = create("div", "contextual-action-menu-heading");
      heading.textContent = action.category;
      node.append(heading);
      previousCategory = action.category;
    }
    const button = actionButton(action, context);
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    node.append(button);
  }

  const footer = create("div", "contextual-action-menu-footer");
  const allCommands = create("button", "contextual-action-menu-item all-commands");
  allCommands.type = "button";
  allCommands.setAttribute("role", "menuitem");
  const allLabel = create("span", "contextual-action-menu-title");
  allLabel.textContent = "All Commands…";
  const shortcut = create("kbd", "contextual-action-shortcut");
  shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";
  allCommands.append(allLabel, shortcut);
  allCommands.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    openCommandPalette();
  });
  footer.append(allCommands);
  node.append(footer);

  document.body.append(node);
  positionMenu(anchor);
  focusMenuButton(0);
}

function renderBar(context: ScoutActionContext) {
  const node = ensureBar();
  const actions = contextualActions(context);
  const quick = quickActions(context, actions);
  node.replaceChildren();
  node.hidden = context.selectedPaths.length === 0;
  if (node.hidden) {
    closeMenu();
    return;
  }

  const selection = create("div", "contextual-action-selection");
  const count = create("span", "contextual-action-count");
  count.textContent = context.selectedPaths.length === 1 ? "1 selected" : `${context.selectedPaths.length} selected`;
  const name = create("span", "contextual-action-name");
  name.textContent = selectionLabel(context);
  name.title = context.selection.length === 1 ? context.selection[0].path : count.textContent;
  selection.append(count, name);

  const quickGroup = create("div", "contextual-action-quick");
  for (const action of quick) quickGroup.append(actionButton(action, context, true));

  const overflowActions = actions.filter((action) => !quick.includes(action));
  const more = create("button", "contextual-action-more");
  more.type = "button";
  more.textContent = overflowActions.length ? `More · ${overflowActions.length}` : "More";
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", menu ? "true" : "false");
  more.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu) {
      closeMenu();
      more.setAttribute("aria-expanded", "false");
      return;
    }
    openMenu(more, context, actions);
    more.setAttribute("aria-expanded", "true");
  });

  node.append(selection, quickGroup, more);
}

function signature(context: ScoutActionContext) {
  const actions = contextualActions(context);
  return [
    context.panePath ?? "",
    ...context.selectedPaths,
    "::",
    ...actions.map((action) => `${action.id}:${action.title}:${action.shortcut ?? ""}`),
  ].join("|");
}

function sync() {
  syncQueued = false;
  const context = actionContext();
  const nextSignature = signature(context);
  const node = ensureBar();
  if (!node.isConnected || nextSignature !== lastSignature) {
    lastSignature = nextSignature;
    renderBar(context);
  }
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(sync);
}

function mutationsNeedSync(mutations: MutationRecord[]) {
  return mutations.some((mutation) => {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (!target) return true;
    return !target.closest(".contextual-action-bar, .contextual-action-menu");
  });
}

function handlePointerDown(event: PointerEvent) {
  if (!menu) return;
  if (event.target instanceof Node && menu.contains(event.target)) return;
  const more = bar?.querySelector(".contextual-action-more");
  if (event.target instanceof Node && more?.contains(event.target)) return;
  closeMenu();
}

function handleKeyDown(event: KeyboardEvent) {
  if (!menu) return;
  const buttons = menuButtons();
  const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    bar?.querySelector<HTMLButtonElement>(".contextual-action-more")?.focus();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    focusMenuButton(current + (event.key === "ArrowDown" ? 1 : -1));
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    focusMenuButton(event.key === "Home" ? 0 : buttons.length - 1);
  }
}

function handleResize() {
  if (!menu) return;
  const anchor = bar?.querySelector<HTMLElement>(".contextual-action-more");
  if (anchor) positionMenu(anchor);
}

export function installContextualActions() {
  observer = new MutationObserver((mutations) => {
    if (mutationsNeedSync(mutations)) queueSync();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path", "data-entry-path", "data-git-state"],
  });

  stopActionsChanged = onActionsChanged(queueSync);
  document.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("resize", handleResize);
  window.addEventListener("scout:action-ran", queueSync);
  queueSync();

  return () => {
    observer?.disconnect();
    observer = null;
    stopActionsChanged?.();
    stopActionsChanged = null;
    document.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("scout:action-ran", queueSync);
    closeMenu();
    bar?.remove();
    bar = null;
    lastSignature = "";
    syncQueued = false;
  };
}

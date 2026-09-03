import "../state-recovery.css";
import { actionContext, availableActions, runAction, type ScoutAction } from "./actions";

let observer: MutationObserver | null = null;
let reconcileQueued = false;
let loadingTimer: number | undefined;

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function activePane() {
  return document.querySelector<HTMLElement>(".explorer-pane.active[data-pane-path]");
}

function activeArea() {
  return activePane()?.querySelector<HTMLElement>(".file-area") ?? null;
}

function filterInput() {
  return document.querySelector<HTMLInputElement>('input[aria-label="Filter current folder"]');
}

function currentFilter() {
  return filterInput()?.value.trim() ?? "";
}

function clearFilter() {
  const input = filterInput();
  if (!input) return;
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus({ preventScroll: true });
}

function registryActions() {
  const context = actionContext();
  return new Map(availableActions(context).map((action) => [action.id, action]));
}

function hasParentBreadcrumb() {
  return document.querySelectorAll(".toolbar .breadcrumb").length > 1;
}

function actionButton(action: ScoutAction, label = action.title, primary = false) {
  const button = create("button", `state-recovery-action${primary ? " primary" : ""}`);
  button.type = "button";
  button.textContent = label;
  if (action.shortcut) button.title = `${action.title} · ${action.shortcut}`;
  button.addEventListener("click", () => {
    const context = actionContext();
    void runAction(action.id, context).catch((error) => {
      window.dispatchEvent(new CustomEvent("scout:action-error", {
        detail: { message: error instanceof Error ? error.message : String(error) },
      }));
    });
  });
  return button;
}

function simpleButton(label: string, onClick: () => void, primary = false) {
  const button = create("button", `state-recovery-action${primary ? " primary" : ""}`);
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function removeGenerated(area?: HTMLElement | null) {
  const root = area ?? document;
  root.querySelectorAll(".state-recovery-panel, .state-recovery-error, .state-recovery-loading-copy")
    .forEach((node) => node.remove());
}

function restoreSources() {
  for (const source of document.querySelectorAll<HTMLElement>(".empty-state.state-recovery-source")) {
    source.classList.remove("state-recovery-source");
    source.removeAttribute("aria-hidden");
  }
}

function renderEmptyState(area: HTMLElement) {
  const sources = [...area.querySelectorAll<HTMLElement>(":scope > .empty-state")]
    .filter((source) => !source.closest(".column-browser"));
  if (!sources.length) return;

  const query = currentFilter();
  const noMatch = sources.find((source) => source.textContent?.trim().startsWith("No matches"));
  const emptyFolder = sources.find((source) => source.textContent?.trim() === "This folder is empty.");
  const source = query && noMatch ? noMatch : emptyFolder ?? noMatch;
  if (!source) return;

  for (const item of sources) {
    item.classList.add("state-recovery-source");
    item.setAttribute("aria-hidden", "true");
  }

  const panel = create("section", "state-recovery-panel");
  panel.setAttribute("aria-live", "polite");
  const eyebrow = create("div", "state-recovery-eyebrow");
  const title = create("div", "state-recovery-title");
  const detail = create("div", "state-recovery-detail");
  const actions = create("div", "state-recovery-actions");

  if (source === noMatch && query) {
    eyebrow.textContent = "Current folder";
    title.textContent = "No matches";
    detail.textContent = `Nothing here matches “${query}”.`;
    actions.append(simpleButton("Clear Filter", clearFilter, true));

    const deepSearch = registryActions().get("navigation.deep-search");
    if (deepSearch) actions.append(actionButton(deepSearch, "Search Everywhere"));
  } else {
    eyebrow.textContent = "Folder";
    title.textContent = "Empty folder";
    detail.textContent = "Drop files here, paste something, or create a folder to get started.";

    const actionsById = registryActions();
    const newFolder = actionsById.get("file.new-folder");
    const paste = actionsById.get("clipboard.paste");
    if (newFolder) actions.append(actionButton(newFolder, "New Folder"));
    if (paste) actions.append(actionButton(paste, "Paste"));
  }

  panel.append(eyebrow, title, detail);
  if (actions.childElementCount) panel.append(actions);
  source.insertAdjacentElement("afterend", panel);
}

function renderError(area: HTMLElement) {
  const status = document.querySelector<HTMLElement>(".statusbar .status-error");
  const message = status?.textContent?.trim();
  if (!message) return false;

  const banner = create("section", "state-recovery-error");
  banner.setAttribute("role", "alert");
  const copy = create("div", "state-recovery-error-copy");
  const title = create("div", "state-recovery-error-title");
  title.textContent = "Couldn’t load this location";
  const detail = create("div", "state-recovery-error-detail");
  detail.textContent = message;
  detail.title = message;
  copy.append(title, detail);

  const actions = create("div", "state-recovery-error-actions");
  const actionsById = registryActions();
  const refresh = actionsById.get("navigation.refresh");
  const parent = actionsById.get("navigation.parent");
  if (refresh) actions.append(actionButton(refresh, "Retry", true));
  if (parent && hasParentBreadcrumb()) actions.append(actionButton(parent, "Go to Parent"));
  banner.append(copy, actions);
  area.prepend(banner);
  return true;
}

function discardOwnMutations() {
  observer?.takeRecords();
}

function syncLoading(area: HTMLElement) {
  if (loadingTimer !== undefined) {
    window.clearTimeout(loadingTimer);
    loadingTimer = undefined;
  }
  area.querySelector(".state-recovery-loading-copy")?.remove();
  if (!area.querySelector(".directory-loading")) return;

  loadingTimer = window.setTimeout(() => {
    loadingTimer = undefined;
    const currentArea = activeArea();
    if (!currentArea || !currentArea.querySelector(".directory-loading")) return;
    const label = create("div", "state-recovery-loading-copy");
    label.setAttribute("role", "status");
    label.textContent = "Loading folder…";
    currentArea.append(label);
    discardOwnMutations();
  }, 450);
}

function reconcile() {
  reconcileQueued = false;
  restoreSources();
  removeGenerated();

  const area = activeArea();
  if (!area) {
    discardOwnMutations();
    return;
  }
  if (!renderError(area)) renderEmptyState(area);
  syncLoading(area);
  discardOwnMutations();
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function mutationsNeedReconcile(mutations: MutationRecord[]) {
  return mutations.some((mutation) => {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (!target) return true;
    return !target.closest(".state-recovery-panel, .state-recovery-error, .state-recovery-loading-copy");
  });
}

export function installStateRecovery() {
  observer = new MutationObserver((mutations) => {
    if (mutationsNeedReconcile(mutations)) queueReconcile();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path"],
  });

  window.addEventListener("scout:action-ran", queueReconcile);
  window.addEventListener("scout:navigate", queueReconcile);
  queueReconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("scout:action-ran", queueReconcile);
    window.removeEventListener("scout:navigate", queueReconcile);
    if (loadingTimer !== undefined) window.clearTimeout(loadingTimer);
    loadingTimer = undefined;
    restoreSources();
    removeGenerated();
    reconcileQueued = false;
  };
}

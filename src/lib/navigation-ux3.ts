import { listDirectory } from "./fs";
import { registerActions } from "./actions";

const CLOSED_TABS_KEY = "scout.closed-tabs.v1";
const HISTORY_LIMIT = 80;
const CLOSED_LIMIT = 16;

type Direction = -1 | 1;

interface ClosedTab {
  path: string;
  title: string;
  closedAt: number;
}

interface PaneTrail {
  entries: string[];
  index: number;
  lastPath: string;
}

let observer: MutationObserver | null = null;
let menu: HTMLDivElement | null = null;
let longPressTimer: number | undefined;
let suppressNavClick: HTMLButtonElement | null = null;
let closedTabs = readClosedTabs();
const paneTrails = new WeakMap<HTMLElement, PaneTrail>();
const tabPaths = new WeakMap<HTMLElement, string>();

function readClosedTabs(): ClosedTab[] {
  try {
    const raw = localStorage.getItem(CLOSED_TABS_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as ClosedTab[];
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry) => typeof entry?.path === "string" && !!entry.path)
      .slice(0, CLOSED_LIMIT);
  } catch {
    return [];
  }
}

function persistClosedTabs() {
  localStorage.setItem(CLOSED_TABS_KEY, JSON.stringify(closedTabs.slice(0, CLOSED_LIMIT)));
}

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
}

function samePath(a: string, b: string) {
  return comparablePath(a) === comparablePath(b);
}

function pathLabel(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).filter(Boolean).at(-1);
  return name || path || "/";
}

function activePane() {
  return document.querySelector<HTMLElement>(".explorer-pane.active");
}

function activePanePath() {
  return activePane()?.dataset.panePath ?? null;
}

function activeTab() {
  return document.querySelector<HTMLElement>(".tab-strip > .tab.active");
}

function tabElements() {
  return [...document.querySelectorAll<HTMLElement>(".tab-strip > .tab")];
}

function navButton(direction: Direction) {
  const label = direction < 0 ? "Back" : "Forward";
  return document.querySelector<HTMLButtonElement>(`.toolbar button[aria-label="${label}"]`);
}

function closeMenu() {
  menu?.remove();
  menu = null;
}

function clampMenu(node: HTMLElement, x: number, y: number) {
  const margin = 8;
  const rect = node.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

interface MenuItem {
  label?: string;
  detail?: string;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  run?: () => void | Promise<void>;
}

function showMenu(items: MenuItem[], x: number, y: number, ariaLabel: string) {
  closeMenu();
  const node = document.createElement("div");
  node.className = "ux3-navigation-menu";
  node.setAttribute("role", "menu");
  node.setAttribute("aria-label", ariaLabel);

  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement("div");
      separator.className = "ux3-menu-separator";
      separator.setAttribute("role", "separator");
      node.append(separator);
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ux3-menu-item";
    button.setAttribute("role", "menuitem");
    button.disabled = !!item.disabled;
    if (item.checked) button.classList.add("checked");

    const mark = document.createElement("span");
    mark.className = "ux3-menu-mark";
    mark.textContent = item.checked ? "✓" : "";
    const copy = document.createElement("span");
    copy.className = "ux3-menu-copy";
    const label = document.createElement("span");
    label.className = "ux3-menu-label";
    label.textContent = item.label ?? "";
    copy.append(label);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "ux3-menu-detail";
      detail.textContent = item.detail;
      copy.append(detail);
    }
    button.append(mark, copy);
    button.addEventListener("click", () => {
      closeMenu();
      void item.run?.();
    });
    node.append(button);
  }

  node.addEventListener("keydown", (event) => {
    const buttons = [...node.querySelectorAll<HTMLButtonElement>(".ux3-menu-item:not(:disabled)")];
    if (!buttons.length) return;
    const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1;
    let next = current;
    if (event.key === "ArrowDown" || event.key === "Tab" && !event.shiftKey) next = (current + 1 + buttons.length) % buttons.length;
    else if (event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey) next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    } else return;
    event.preventDefault();
    buttons[next]?.focus();
  });

  document.body.append(node);
  menu = node;
  clampMenu(node, x, y);
  queueMicrotask(() => node.querySelector<HTMLButtonElement>(".ux3-menu-item:not(:disabled)")?.focus());
}

function reconcilePaneTrail(pane: HTMLElement) {
  const path = pane.dataset.panePath;
  if (!path) return;
  const trail = paneTrails.get(pane);
  if (!trail) {
    paneTrails.set(pane, { entries: [path], index: 0, lastPath: path });
    return;
  }
  if (samePath(path, trail.lastPath)) return;

  if (trail.index > 0 && samePath(path, trail.entries[trail.index - 1] ?? "")) {
    trail.index -= 1;
  } else if (trail.index < trail.entries.length - 1 && samePath(path, trail.entries[trail.index + 1] ?? "")) {
    trail.index += 1;
  } else {
    trail.entries = [...trail.entries.slice(0, trail.index + 1), path].slice(-HISTORY_LIMIT);
    trail.index = trail.entries.length - 1;
  }
  trail.lastPath = path;
}

function reconcileTrails() {
  for (const pane of document.querySelectorAll<HTMLElement>(".explorer-pane")) reconcilePaneTrail(pane);
}

function syncActiveTabPath() {
  const tab = activeTab();
  const path = activePanePath();
  if (!tab || !path) return;
  tabPaths.set(tab, path);
  tab.dataset.uxTabPath = path;
}

function enhanceBreadcrumbs() {
  for (const separator of document.querySelectorAll<HTMLElement>(".breadcrumbs .breadcrumb-sep")) {
    separator.classList.add("ux3-breadcrumb-trigger");
    separator.setAttribute("role", "button");
    separator.tabIndex = 0;
    separator.setAttribute("aria-label", "Show sibling folders");
  }
}

function enhanceFileAreas() {
  for (const area of document.querySelectorAll<HTMLElement>(".explorer-pane .file-area")) {
    if (!area.hasAttribute("tabindex")) area.tabIndex = 0;
  }
}

function reconcile() {
  reconcileTrails();
  syncActiveTabPath();
  enhanceBreadcrumbs();
  enhanceFileAreas();
}

function waitForPanePathChange(pane: HTMLElement, before: string) {
  return new Promise<void>((resolve) => {
    const started = performance.now();
    const check = () => {
      const next = pane.dataset.panePath ?? "";
      if (!samePath(next, before) || performance.now() - started > 1200) {
        resolve();
        return;
      }
      window.setTimeout(check, 18);
    };
    check();
  });
}

async function navigateHistorySteps(direction: Direction, count: number) {
  const pane = activePane();
  if (!pane) return;
  for (let step = 0; step < count; step += 1) {
    const button = navButton(direction);
    if (!button || button.disabled) break;
    const before = pane.dataset.panePath ?? "";
    button.click();
    await waitForPanePathChange(pane, before);
  }
}

function historyMenuItems(direction: Direction) {
  const pane = activePane();
  if (!pane) return [] as MenuItem[];
  reconcilePaneTrail(pane);
  const trail = paneTrails.get(pane);
  if (!trail) return [] as MenuItem[];
  const indexes = direction < 0
    ? Array.from({ length: trail.index }, (_, offset) => trail.index - 1 - offset)
    : Array.from({ length: trail.entries.length - trail.index - 1 }, (_, offset) => trail.index + 1 + offset);
  return indexes.slice(0, 18).map((index) => {
    const path = trail.entries[index] ?? "";
    const distance = Math.abs(index - trail.index);
    return {
      label: pathLabel(path),
      detail: path,
      run: () => navigateHistorySteps(direction, distance),
    } satisfies MenuItem;
  });
}

function showHistoryMenu(button: HTMLButtonElement, direction: Direction, x?: number, y?: number) {
  const items = historyMenuItems(direction);
  if (!items.length) return;
  const rect = button.getBoundingClientRect();
  showMenu(items, x ?? rect.left, y ?? rect.bottom + 5, direction < 0 ? "Back history" : "Forward history");
}

function clearLongPress() {
  if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
  longPressTimer = undefined;
}

function beginLongPress(button: HTMLButtonElement, direction: Direction) {
  clearLongPress();
  longPressTimer = window.setTimeout(() => {
    longPressTimer = undefined;
    suppressNavClick = button;
    showHistoryMenu(button, direction);
    window.setTimeout(() => {
      if (suppressNavClick === button) suppressNavClick = null;
    }, 500);
  }, 460);
}

function currentBreadcrumbPaths() {
  const container = document.querySelector<HTMLElement>(".breadcrumbs");
  const raw = container?.getAttribute("title") ?? activePanePath() ?? "";
  const buttons = [...document.querySelectorAll<HTMLElement>(".breadcrumbs .breadcrumb")];
  if (!raw || !buttons.length) return [] as string[];
  const normalized = raw.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const drive = /^[a-zA-Z]:/.exec(normalized)?.[0] ?? null;
  const unc = raw.startsWith("\\\\");
  const unixAbsolute = !drive && !unc && normalized.startsWith("/");
  return parts.map((_, index) => {
    if (drive) {
      const rest = parts.slice(1, index + 1);
      return rest.length ? `${drive}\\${rest.join("\\")}` : `${drive}\\`;
    }
    if (unc) return `\\\\${parts.slice(0, index + 1).join("\\")}`;
    return `${unixAbsolute ? "/" : ""}${parts.slice(0, index + 1).join("/")}`;
  });
}

async function showSiblingMenu(separator: HTMLElement) {
  const separators = [...document.querySelectorAll<HTMLElement>(".breadcrumbs .breadcrumb-sep")];
  const index = separators.indexOf(separator);
  const paths = currentBreadcrumbPaths();
  const parentPath = paths[index];
  const currentChild = paths[index + 1];
  if (index < 0 || !parentPath) return;

  try {
    const listing = await listDirectory(parentPath, false);
    const folders = listing.entries
      .filter((entry) => entry.kind === "directory")
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const rect = separator.getBoundingClientRect();
    const items: MenuItem[] = folders.length
      ? folders.map((entry) => ({
          label: entry.name,
          detail: entry.path,
          checked: !!currentChild && samePath(entry.path, currentChild),
          run: () => { window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: entry.path } })); },
        }))
      : [{ label: "No sibling folders", disabled: true }];
    showMenu(items, rect.left, rect.bottom + 5, "Sibling folders");
  } catch (error) {
    window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message: String(error), error: true } }));
  }
}

function openPathInNewTab(path: string) {
  const add = document.querySelector<HTMLButtonElement>(".new-tab-button");
  if (!add) return;
  add.click();
  queueMicrotask(() => {
    if (!samePath(activePanePath() ?? "", path)) {
      window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path } }));
    }
  });
}

function recordClosedTab(tab: HTMLElement) {
  const path = tabPaths.get(tab) ?? tab.dataset.uxTabPath ?? (tab.classList.contains("active") ? activePanePath() : null);
  if (!path) return;
  const title = tab.textContent?.trim() || pathLabel(path);
  closedTabs = [
    { path, title, closedAt: Date.now() },
    ...closedTabs.filter((entry) => !samePath(entry.path, path) || entry.title !== title),
  ].slice(0, CLOSED_LIMIT);
  persistClosedTabs();
}

function reopenClosedTab() {
  const entry = closedTabs.shift();
  if (!entry) return false;
  persistClosedTabs();
  openPathInNewTab(entry.path);
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message: `Reopened ${entry.title}` } }));
  return true;
}

function duplicateTab(tab = activeTab()) {
  if (!tab) return false;
  const path = tabPaths.get(tab) ?? tab.dataset.uxTabPath ?? (tab.classList.contains("active") ? activePanePath() : null);
  if (!path) return false;
  openPathInNewTab(path);
  return true;
}

function clickTabClose(tab: HTMLElement) {
  tab.querySelector<HTMLElement>(".tab-close")?.click();
}

function showTabMenu(tab: HTMLElement, x: number, y: number) {
  syncActiveTabPath();
  const tabs = tabElements();
  const index = tabs.indexOf(tab);
  const canClose = tabs.length > 1;
  const hasLeft = index > 0;
  const hasRight = index >= 0 && index < tabs.length - 1;
  showMenu([
    { label: "Duplicate Tab", run: () => { duplicateTab(tab); } },
    { label: "Reopen Closed Tab", disabled: closedTabs.length === 0, run: () => { reopenClosedTab(); } },
    { separator: true },
    { label: "Close Tab", disabled: !canClose, run: () => clickTabClose(tab) },
    {
      label: "Close Other Tabs",
      disabled: !canClose,
      run: () => tabs.filter((candidate) => candidate !== tab).reverse().forEach(clickTabClose),
    },
    {
      label: "Close Tabs to the Left",
      disabled: !hasLeft,
      run: () => tabs.slice(0, index).reverse().forEach(clickTabClose),
    },
    {
      label: "Close Tabs to the Right",
      disabled: !hasRight,
      run: () => tabs.slice(index + 1).reverse().forEach(clickTabClose),
    },
  ], x, y, "Tab options");
}

function focusPane(direction: Direction) {
  const panes = [...document.querySelectorAll<HTMLElement>(".explorer-pane")];
  if (panes.length < 2) return false;
  const active = panes.findIndex((pane) => pane.classList.contains("active"));
  if (active < 0) return false;
  const next = (active + direction + panes.length) % panes.length;
  const pane = panes[next];
  if (!pane) return false;
  pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  queueMicrotask(() => pane.querySelector<HTMLElement>(".file-area")?.focus({ preventScroll: true }));
  return true;
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLButtonElement>('.toolbar button[aria-label="Back"], .toolbar button[aria-label="Forward"]');
  if (!button || button.disabled) return;
  beginLongPress(button, button.getAttribute("aria-label") === "Back" ? -1 : 1);
}

function handlePointerEnd() {
  clearLongPress();
}

function handleClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const nav = target?.closest<HTMLButtonElement>('.toolbar button[aria-label="Back"], .toolbar button[aria-label="Forward"]');
  if (nav && suppressNavClick === nav) {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNavClick = null;
    return;
  }

  const close = target?.closest<HTMLElement>(".tab-close");
  const tab = close?.closest<HTMLElement>(".tab-strip > .tab");
  if (tab) recordClosedTab(tab);

  const separator = target?.closest<HTMLElement>(".breadcrumbs .breadcrumb-sep");
  if (separator) {
    event.preventDefault();
    event.stopPropagation();
    void showSiblingMenu(separator);
    return;
  }

  const crumb = target?.closest<HTMLElement>(".breadcrumbs .breadcrumb");
  if (crumb && (event.metaKey || event.ctrlKey || event.altKey)) {
    const crumbs = [...document.querySelectorAll<HTMLElement>(".breadcrumbs .breadcrumb")];
    const index = crumbs.indexOf(crumb);
    const path = currentBreadcrumbPaths()[index];
    if (path) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPathInNewTab(path);
    }
  }
}

function handleContextMenu(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const back = target?.closest<HTMLButtonElement>('.toolbar button[aria-label="Back"]');
  const forward = target?.closest<HTMLButtonElement>('.toolbar button[aria-label="Forward"]');
  if (back || forward) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showHistoryMenu((back ?? forward)!, back ? -1 : 1, event.clientX, event.clientY);
    return;
  }

  const tab = target?.closest<HTMLElement>(".tab-strip > .tab");
  if (tab) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showTabMenu(tab, event.clientX, event.clientY);
  }
}

function handleBreadcrumbKeyDown(event: KeyboardEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".breadcrumbs .breadcrumb-sep") : null;
  if (!target || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void showSiblingMenu(target);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function handleKeyDown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return;
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (modifier && event.shiftKey && key === "t") {
    if (!closedTabs.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    reopenClosedTab();
    return;
  }
  if (modifier && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    if (!focusPane(event.key === "ArrowLeft" ? -1 : 1)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!menu) return;
  const target = event.target instanceof Node ? event.target : null;
  if (target && menu.contains(target)) return;
  closeMenu();
}

export function installNavigationUx3() {
  const unregisterActions = registerActions([
    {
      id: "tabs.duplicate-active",
      title: "Duplicate Active Tab",
      category: "Tabs",
      keywords: ["clone", "copy", "tab", "same folder"],
      available: (context) => context.hasActiveTab,
      run: () => { duplicateTab(); },
    },
    {
      id: "tabs.reopen-closed",
      title: "Reopen Closed Tab",
      category: "Tabs",
      keywords: ["restore", "undo close", "closed tab"],
      shortcut: "⇧⌘T / Ctrl+Shift+T",
      available: () => closedTabs.length > 0,
      run: () => { reopenClosedTab(); },
    },
    {
      id: "navigation.focus-next-pane",
      title: "Focus Next Pane",
      category: "Navigation",
      keywords: ["split", "pane", "focus", "next"],
      shortcut: "⌥⌘→ / Ctrl+Alt+→",
      available: () => document.querySelectorAll(".explorer-pane").length > 1,
      run: () => { focusPane(1); },
    },
    {
      id: "navigation.focus-previous-pane",
      title: "Focus Previous Pane",
      category: "Navigation",
      keywords: ["split", "pane", "focus", "previous"],
      shortcut: "⌥⌘← / Ctrl+Alt+←",
      available: () => document.querySelectorAll(".explorer-pane").length > 1,
      run: () => { focusPane(-1); },
    },
  ]);

  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-pane-path"] });
  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("pointerup", handlePointerEnd, true);
  window.addEventListener("pointercancel", handlePointerEnd, true);
  window.addEventListener("click", handleClick, true);
  window.addEventListener("contextmenu", handleContextMenu, true);
  window.addEventListener("keydown", handleBreadcrumbKeyDown, true);
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  queueMicrotask(reconcile);

  return () => {
    unregisterActions();
    observer?.disconnect();
    observer = null;
    clearLongPress();
    closeMenu();
    window.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("pointerup", handlePointerEnd, true);
    window.removeEventListener("pointercancel", handlePointerEnd, true);
    window.removeEventListener("click", handleClick, true);
    window.removeEventListener("contextmenu", handleContextMenu, true);
    window.removeEventListener("keydown", handleBreadcrumbKeyDown, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  };
}

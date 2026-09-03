import { registerAction } from "./actions";

const STORAGE_KEY = "scout.sidebar.hidden.v1";
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function shell() {
  return document.querySelector<HTMLElement>(".app-shell");
}

function isHidden() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function focusExplorerIfNeeded() {
  const active = document.activeElement;
  if (!(active instanceof Element) || !active.closest(".sidebar")) return;
  const area = document.querySelector<HTMLElement>(".explorer-pane.active .file-area")
    ?? document.querySelector<HTMLElement>(".explorer-pane.active");
  area?.focus({ preventScroll: true });
}

function apply(hidden: boolean, persist = true) {
  const appShell = shell();
  if (!appShell) return;
  if (hidden) focusExplorerIfNeeded();
  appShell.classList.toggle("scout-sidebar-hidden", hidden);
  appShell.setAttribute("data-scout-sidebar-visible", hidden ? "false" : "true");
  const sidebar = appShell.querySelector<HTMLElement>(":scope > .sidebar");
  sidebar?.setAttribute("aria-hidden", hidden ? "true" : "false");
  if (persist) localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
  window.dispatchEvent(new CustomEvent("scout:sidebar-visibility", { detail: { visible: !hidden } }));
}

function toggle() {
  const appShell = shell();
  if (!appShell) return;
  apply(!appShell.classList.contains("scout-sidebar-hidden"));
}

function shortcutMatches(event: KeyboardEvent) {
  const key = event.key.toLocaleLowerCase();
  if (isMac) {
    return key === "s" && event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey;
  }
  return key === "b" && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
}

function handleKeyDown(event: KeyboardEvent) {
  if (!shortcutMatches(event)) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggle();
}

export function installSidebarVisibility() {
  const unregister = registerAction({
    id: "view.toggle-sidebar",
    title: "Toggle Sidebar",
    category: "View",
    shortcut: isMac ? "⌃⌘S" : "Ctrl+Shift+B",
    keywords: ["sidebar", "navigation", "hide", "show", "focus", "layout"],
    run: () => toggle(),
  });

  const observer = new MutationObserver(() => {
    const appShell = shell();
    if (!appShell || appShell.hasAttribute("data-scout-sidebar-visible")) return;
    apply(isHidden(), false);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  apply(isHidden(), false);
  window.addEventListener("keydown", handleKeyDown, true);

  return () => {
    unregister();
    observer.disconnect();
    window.removeEventListener("keydown", handleKeyDown, true);
    const appShell = shell();
    appShell?.classList.remove("scout-sidebar-hidden");
    appShell?.removeAttribute("data-scout-sidebar-visible");
    appShell?.querySelector<HTMLElement>(":scope > .sidebar")?.removeAttribute("aria-hidden");
  };
}

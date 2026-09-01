import { invoke } from "@tauri-apps/api/core";

let observer: MutationObserver | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function terminalPath() {
  const selected = [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row.selected")];
  if (selected.length === 1) return selected[0].dataset.entryPath ?? null;
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function enhanceMenu(menu: HTMLElement) {
  if (menu.dataset.terminalEnhanced === "1") return;
  menu.dataset.terminalEnhanced = "1";
  const path = terminalPath();
  if (!path) return;
  const separator = element("div", "menu-separator terminal-menu-separator");
  const button = element("button");
  button.type = "button";
  button.textContent = "Open Terminal Here";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.remove();
    void invoke<void>("open_terminal", { path }).catch((error) => console.error("Scout could not open a terminal", error));
  });
  menu.append(separator, button);
}

function reconcile() {
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceMenu(menu);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier || !event.shiftKey || event.key.toLowerCase() !== "t") return;
  const path = terminalPath();
  if (!path) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void invoke<void>("open_terminal", { path }).catch((error) => console.error("Scout could not open a terminal", error));
}

export function installTerminalActions() {
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}

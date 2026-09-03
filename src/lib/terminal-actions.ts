import { invoke } from "@tauri-apps/api/core";
import { actionContext, registerAction, runAction } from "./actions";

function terminalPath() {
  const context = actionContext();
  if (context.selection.length === 1) return context.selection[0].path;
  return context.panePath;
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier || !event.shiftKey || event.key.toLowerCase() !== "t") return;
  const path = terminalPath();
  if (!path) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void runAction("tools.open-terminal").catch((error) => {
    window.dispatchEvent(new CustomEvent("scout:action-error", {
      detail: { message: error instanceof Error ? error.message : String(error) },
    }));
  });
}

export function installTerminalActions() {
  const unregister = registerAction({
    id: "tools.open-terminal",
    title: "Open Terminal Here",
    category: "Tools",
    shortcut: `${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}⇧T`,
    keywords: ["shell", "console", "command line", "terminal"],
    contextMenu: true,
    contextMenuOrder: 80,
    available: (context) => !!(context.selection.length === 1 ? context.selection[0].path : context.panePath),
    run: async (context) => {
      const path = context.selection.length === 1 ? context.selection[0].path : context.panePath;
      if (!path) throw new Error("No folder is available for the terminal");
      await invoke<void>("open_terminal", { path });
    },
  });
  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    unregister();
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}

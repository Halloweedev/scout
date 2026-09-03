import { registerActions } from "./actions";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const modLabel = isMac ? "⌘" : "Ctrl+";

function emitAppShortcut(key: string, shiftKey = false) {
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    metaKey: isMac,
    ctrlKey: !isMac,
    shiftKey,
    bubbles: true,
    cancelable: true,
  }));
}

function openLegacyGlobalSearch() {
  // Command Palette owns Cmd/Ctrl+K. The existing indexed file search still
  // listens for the old key internally; Alt marks this synthetic bridge so
  // the command-palette handler deliberately ignores it.
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "k",
    metaKey: isMac,
    ctrlKey: !isMac,
    altKey: true,
    bubbles: true,
    cancelable: true,
  }));
}

function handleGlobalSearchRequest() {
  openLegacyGlobalSearch();
}

function handleKeyDown(event: KeyboardEvent) {
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier || !event.shiftKey || event.key.toLocaleLowerCase() !== "f") return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openLegacyGlobalSearch();
}

export function installQolBridge() {
  const unregister = registerActions([
    {
      id: "view.toggle-hidden",
      title: "Toggle Hidden Files",
      category: "View",
      shortcut: `${modLabel}⇧.`,
      keywords: ["dotfiles", "hidden", "invisible"],
      run: () => emitAppShortcut(".", true),
    },
    {
      id: "view.zoom-in",
      title: "Increase Item Size",
      category: "View",
      shortcut: `${modLabel}+`,
      keywords: ["zoom", "icons", "larger"],
      run: () => emitAppShortcut("+"),
    },
    {
      id: "view.zoom-out",
      title: "Decrease Item Size",
      category: "View",
      shortcut: `${modLabel}-`,
      keywords: ["zoom", "icons", "smaller"],
      run: () => emitAppShortcut("-"),
    },
    {
      id: "view.zoom-reset",
      title: "Reset Item Size",
      category: "View",
      shortcut: `${modLabel}0`,
      keywords: ["zoom", "default"],
      run: () => emitAppShortcut("0"),
    },
    {
      id: "view.cycle",
      title: "Cycle View Mode",
      category: "View",
      keywords: ["icons", "list", "columns", "gallery"],
      run: () => {
        const button = document.querySelector<HTMLElement>(".view-cycle");
        if (!button) throw new Error("View controls are not available");
        button.click();
      },
    },
    {
      id: "navigation.refresh",
      title: "Refresh Current Folder",
      category: "Navigation",
      shortcut: "F5",
      keywords: ["reload", "rescan"],
      run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true })),
    },
  ]);

  window.addEventListener("scout:open-global-search", handleGlobalSearchRequest);
  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    unregister();
    window.removeEventListener("scout:open-global-search", handleGlobalSearchRequest);
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}

import { runAction } from "./actions";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function runHistory(action: "navigation.back" | "navigation.forward") {
  void runAction(action).catch(() => {
    // Back/forward are no-ops when the active pane has no matching history entry.
  });
}

function dispatchCanonicalHistoryShortcut(direction: "back" | "forward") {
  // Registry actions advertise the native Windows/Linux Alt+Arrow aliases, but
  // App's canonical history workflow is modifier+[ / ]. Replaying the native
  // alias through the registry would otherwise re-enter this listener forever.
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: direction === "back" ? "[" : "]",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 3 && event.button !== 4) return;
  if (isEditableTarget(event.target) && (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) return;

  event.preventDefault();
  event.stopPropagation();
  runHistory(event.button === 3 ? "navigation.back" : "navigation.forward");
}

function handleAuxClick(event: MouseEvent) {
  if (event.button !== 3 && event.button !== 4) return;
  event.preventDefault();
  event.stopPropagation();
}

function handleKeyDown(event: KeyboardEvent) {
  if (isMac || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const direction = event.key === "ArrowLeft" ? "back" : "forward";
  if (!event.isTrusted) {
    dispatchCanonicalHistoryShortcut(direction);
    return;
  }

  runHistory(direction === "back" ? "navigation.back" : "navigation.forward");
}

export function installMouseNavigation() {
  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("auxclick", handleAuxClick, true);
  window.addEventListener("keydown", handleKeyDown, true);

  return () => {
    window.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("auxclick", handleAuxClick, true);
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}

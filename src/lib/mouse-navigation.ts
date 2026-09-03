import { runAction } from "./actions";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 3 && event.button !== 4) return;
  if (isEditableTarget(event.target) && (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) return;

  event.preventDefault();
  event.stopPropagation();
  const action = event.button === 3 ? "navigation.back" : "navigation.forward";
  void runAction(action).catch(() => {
    // Back/forward are no-ops when the active pane has no matching history entry.
  });
}

function handleAuxClick(event: MouseEvent) {
  if (event.button !== 3 && event.button !== 4) return;
  event.preventDefault();
  event.stopPropagation();
}

export function installMouseNavigation() {
  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("auxclick", handleAuxClick, true);

  return () => {
    window.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("auxclick", handleAuxClick, true);
  };
}

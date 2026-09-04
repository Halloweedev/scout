const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

let typeBuffer = "";
let typeTimer: number | undefined;

function clearTypeBuffer() {
  typeBuffer = "";
  if (typeTimer !== undefined) window.clearTimeout(typeTimer);
  typeTimer = undefined;
}

function visibleControls(sidebar: HTMLElement) {
  return [...sidebar.querySelectorAll<HTMLElement>(
    '.sidebar-section-label[data-scout-sidebar-disclosure="1"], .sidebar-item, .sidebar-section-action',
  )].filter((element) => !element.hidden && element.offsetParent !== null && element.getAttribute("aria-hidden") !== "true");
}

function currentControl(sidebar: HTMLElement) {
  if (!(document.activeElement instanceof HTMLElement)) return null;
  if (!sidebar.contains(document.activeElement)) return null;
  return document.activeElement.closest<HTMLElement>(
    '.sidebar-section-label[data-scout-sidebar-disclosure="1"], .sidebar-item, .sidebar-section-action',
  );
}

function focusControl(control: HTMLElement | undefined) {
  if (!control) return false;
  control.focus({ preventScroll: true });
  control.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function move(sidebar: HTMLElement, delta: number) {
  const controls = visibleControls(sidebar);
  if (!controls.length) return false;
  const current = currentControl(sidebar);
  const index = current ? controls.indexOf(current) : -1;
  const nextIndex = index < 0
    ? (delta > 0 ? 0 : controls.length - 1)
    : (index + delta + controls.length) % controls.length;
  return focusControl(controls[nextIndex]);
}

function focusEdge(sidebar: HTMLElement, edge: "start" | "end") {
  const controls = visibleControls(sidebar);
  return focusControl(edge === "start" ? controls[0] : controls.at(-1));
}

function controlLabel(control: HTMLElement) {
  if (control.classList.contains("sidebar-section-label")) return control.textContent?.trim() ?? "";
  const explicit = control.getAttribute("aria-label")?.trim();
  if (explicit) return explicit;
  return control.textContent?.trim() ?? "";
}

function typeAhead(sidebar: HTMLElement, character: string) {
  if (typeTimer !== undefined) window.clearTimeout(typeTimer);
  typeBuffer += character.toLocaleLowerCase();
  typeTimer = window.setTimeout(clearTypeBuffer, 700);

  const controls = visibleControls(sidebar).filter((control) =>
    control.classList.contains("sidebar-item") || control.classList.contains("sidebar-section-label"),
  );
  if (!controls.length) return false;

  const current = currentControl(sidebar);
  const start = current ? Math.max(0, controls.indexOf(current) + 1) : 0;
  const ordered = [...controls.slice(start), ...controls.slice(0, start)];
  const match = ordered.find((control) => controlLabel(control).toLocaleLowerCase().startsWith(typeBuffer));
  if (match) return focusControl(match);

  // Repeated single-letter presses cycle through matching entries.
  if (typeBuffer.length > 1 && [...typeBuffer].every((value) => value === typeBuffer[0])) {
    typeBuffer = typeBuffer[0] ?? "";
    const repeated = ordered.find((control) => controlLabel(control).toLocaleLowerCase().startsWith(typeBuffer));
    if (repeated) return focusControl(repeated);
  }
  return false;
}

function restoreFocusAfterRemoval(sidebar: HTMLElement, removedIndex: number) {
  window.requestAnimationFrame(() => {
    if (!sidebar.isConnected) return;
    const controls = visibleControls(sidebar);
    if (!controls.length) return;
    focusControl(controls[Math.min(removedIndex, controls.length - 1)]);
  });
}

function removeRowAndRestoreFocus(sidebar: HTMLElement, row: HTMLElement) {
  const primary = row.querySelector<HTMLElement>(".workspace-open");
  const remove = row.querySelector<HTMLButtonElement>(".workspace-delete");
  if (!remove) return false;
  const removedIndex = primary ? visibleControls(sidebar).indexOf(primary) : -1;
  remove.click();
  if (removedIndex >= 0) restoreFocusAfterRemoval(sidebar, removedIndex);
  return true;
}

function handleSidebarDelete(event: KeyboardEvent, sidebar: HTMLElement, target: Element) {
  const row = target.closest<HTMLElement>(".scout-sidebar-order-row");
  const noModifiers = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  const plainRemove = !!row && noModifiers
    && (event.key === "Delete" || (isMac && event.key === "Backspace"));
  const sidebarDeleteKey = event.key === "Delete"
    || (isMac && event.key === "Backspace" && (noModifiers || (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey)));
  if (!sidebarDeleteKey) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  clearTypeBuffer();

  if (plainRemove && row) removeRowAndRestoreFocus(sidebar, row);
  return true;
}

function handleSidebarF2(event: KeyboardEvent, target: Element) {
  if (event.key !== "F2" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;

  // Bookmark/Workspace primary controls own F2 through sidebar-order.ts.
  // Every other sidebar surface consumes it so App's stale file selection
  // cannot be renamed while keyboard focus belongs to sidebar chrome.
  if (target.closest(".scout-sidebar-order-row .workspace-open")) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  clearTypeBuffer();
  return true;
}

function handleSidebarActivation(event: KeyboardEvent, sidebar: HTMLElement, target: Element) {
  if (event.key !== "Enter" && event.key !== " ") return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  clearTypeBuffer();

  const disclosure = target.closest<HTMLElement>('.sidebar-section-label[data-scout-sidebar-disclosure="1"]');
  if (disclosure) {
    disclosure.click();
    return true;
  }

  const button = target.closest<HTMLButtonElement>("button");
  if (!button || !sidebar.contains(button) || button.disabled) return true;

  const row = button.closest<HTMLElement>(".scout-sidebar-order-row");
  if (button.classList.contains("workspace-delete") && row) {
    removeRowAndRestoreFocus(sidebar, row);
    return true;
  }

  button.click();
  return true;
}

function handleKeyDown(event: KeyboardEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const sidebar = target.closest<HTMLElement>(".sidebar");
  if (!sidebar) return;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return;
  if (handleSidebarDelete(event, sidebar, target)) return;
  if (handleSidebarF2(event, target)) return;
  if (handleSidebarActivation(event, sidebar, target)) return;

  // Alt+ArrowUp/Down belongs to the reorderable Bookmark/Workspace layer.
  // Yield here so normal sidebar focus traversal never races that action.
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;

  if (event.key === "ArrowDown") {
    if (!move(sidebar, 1)) return;
    event.preventDefault();
    event.stopPropagation();
    clearTypeBuffer();
    return;
  }
  if (event.key === "ArrowUp") {
    if (!move(sidebar, -1)) return;
    event.preventDefault();
    event.stopPropagation();
    clearTypeBuffer();
    return;
  }
  if (event.key === "Home") {
    if (!focusEdge(sidebar, "start")) return;
    event.preventDefault();
    event.stopPropagation();
    clearTypeBuffer();
    return;
  }
  if (event.key === "End") {
    if (!focusEdge(sidebar, "end")) return;
    event.preventDefault();
    event.stopPropagation();
    clearTypeBuffer();
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || /\s/.test(event.key)) return;
  if (!typeAhead(sidebar, event.key)) return;
  event.preventDefault();
  event.stopPropagation();
}

export function installSidebarKeyboardNavigation() {
  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    clearTypeBuffer();
  };
}

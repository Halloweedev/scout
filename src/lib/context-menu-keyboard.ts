let observer: MutationObserver | null = null;
let reconcileQueued = false;

const MENU_MARGIN = 8;

function menuButtons(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
    .filter((button) => button.offsetParent !== null);
}

function setRovingFocus(menu: HTMLElement, target: HTMLButtonElement | null, focus = false) {
  const buttons = menuButtons(menu);
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  if (focus) target?.focus({ preventScroll: true });
}

function clampMenu(menu: HTMLElement) {
  const rect = menu.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  let left = Number.parseFloat(menu.style.left);
  let top = Number.parseFloat(menu.style.top);
  if (!Number.isFinite(left)) left = rect.left;
  if (!Number.isFinite(top)) top = rect.top;

  const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - rect.width - MENU_MARGIN);
  const maxTop = Math.max(MENU_MARGIN, window.innerHeight - rect.height - MENU_MARGIN);
  const nextLeft = Math.min(Math.max(left, MENU_MARGIN), maxLeft);
  const nextTop = Math.min(Math.max(top, MENU_MARGIN), maxTop);

  if (Math.abs(nextLeft - left) > 0.5) menu.style.left = `${nextLeft}px`;
  if (Math.abs(nextTop - top) > 0.5) menu.style.top = `${nextTop}px`;
}

function enhanceMenu(menu: HTMLElement) {
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-orientation", "vertical");

  const buttons = menuButtons(menu);
  for (const button of buttons) button.setAttribute("role", "menuitem");

  const focused = document.activeElement instanceof HTMLButtonElement && menu.contains(document.activeElement)
    ? document.activeElement
    : null;
  setRovingFocus(menu, focused ?? buttons[0] ?? null);

  requestAnimationFrame(() => clampMenu(menu));
}

function reconcileMenus() {
  reconcileQueued = false;
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceMenu(menu);
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcileMenus);
}

function activeMenu() {
  return document.querySelector<HTMLElement>(".context-menu");
}

function selectedContextRow() {
  const pane = document.querySelector<HTMLElement>(".explorer-pane.active");
  if (!pane) return null;
  return pane.querySelector<HTMLElement>(".pane-file-row[data-ux-cursor='true'].selected")
    ?? pane.querySelector<HTMLElement>(".pane-file-row.selected");
}

function openKeyboardContextMenu(event: KeyboardEvent) {
  const row = selectedContextRow();
  if (!row) return false;
  const rect = row.getBoundingClientRect();
  const x = Math.min(window.innerWidth - MENU_MARGIN, Math.max(MENU_MARGIN, rect.left + Math.min(28, rect.width / 2)));
  const y = Math.min(window.innerHeight - MENU_MARGIN, Math.max(MENU_MARGIN, rect.top + Math.min(24, rect.height / 2)));

  row.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 0,
    clientX: x,
    clientY: y,
  }));

  window.setTimeout(() => {
    const menu = activeMenu();
    if (!menu) return;
    enhanceMenu(menu);
    const first = menuButtons(menu)[0] ?? null;
    setRovingFocus(menu, first, true);
  }, 0);

  event.preventDefault();
  event.stopPropagation();
  return true;
}

function moveFocus(menu: HTMLElement, delta: number) {
  const buttons = menuButtons(menu);
  if (!buttons.length) return;
  const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1;
  const index = current < 0
    ? (delta > 0 ? 0 : buttons.length - 1)
    : (current + delta + buttons.length) % buttons.length;
  setRovingFocus(menu, buttons[index], true);
}

function handleKeyDown(event: KeyboardEvent) {
  const keyboardMenuRequest = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
  const menu = activeMenu();

  if (!menu) {
    if (keyboardMenuRequest) openKeyboardContextMenu(event);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    event.stopPropagation();
    moveFocus(menu, 1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    moveFocus(menu, -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    const buttons = menuButtons(menu);
    if (!buttons.length) return;
    event.preventDefault();
    event.stopPropagation();
    setRovingFocus(menu, event.key === "Home" ? buttons[0] : buttons.at(-1) ?? null, true);
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    moveFocus(menu, event.shiftKey ? -1 : 1);
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && document.activeElement instanceof HTMLButtonElement && menu.contains(document.activeElement)) {
    event.preventDefault();
    event.stopPropagation();
    document.activeElement.click();
  }
}

function handlePointerMove(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".context-menu button:not(:disabled)") : null;
  const menu = target?.closest<HTMLElement>(".context-menu");
  if (!target || !menu) return;
  setRovingFocus(menu, target);
}

function handleResize() {
  const menu = activeMenu();
  if (menu) clampMenu(menu);
}

export function installContextMenuKeyboard() {
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("resize", handleResize);
  queueReconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("pointermove", handlePointerMove, true);
    window.removeEventListener("resize", handleResize);
  };
}

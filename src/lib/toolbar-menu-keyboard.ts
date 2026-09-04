let observer: MutationObserver | null = null;
let reconcileQueued = false;
let pendingFocus: { trigger: HTMLButtonElement; edge: "first" | "last" } | null = null;
let typeahead = "";
let typeaheadAt = 0;

const TYPEAHEAD_TIMEOUT = 700;

function menus() {
  return [...document.querySelectorAll<HTMLElement>(".view-menu, .toolbar-dropdown-menu")]
    .filter((menu) => menu.offsetParent !== null);
}

function activeMenu() {
  return menus()[0] ?? null;
}

function allMenuButtons(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLButtonElement>("button")];
}

function menuButtons(menu: HTMLElement) {
  return allMenuButtons(menu)
    .filter((button) => !button.disabled && button.offsetParent !== null);
}

function triggerFor(menu: HTMLElement) {
  const group = menu.closest<HTMLElement>(".toolbar-view-group, .toolbar-more");
  return group?.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']") ?? null;
}

function setRoving(menu: HTMLElement, target: HTMLButtonElement | null, focus = false) {
  const buttons = menuButtons(menu);
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  if (focus) target?.focus({ preventScroll: true });
}

function enhance(menu: HTMLElement) {
  menu.setAttribute("aria-orientation", "vertical");
  for (const button of allMenuButtons(menu)) {
    if (button.hasAttribute("role")) continue;
    button.setAttribute("role", "menuitem");
    button.dataset.scoutToolbarMenuRole = "1";
  }

  const buttons = menuButtons(menu);
  const focused = document.activeElement instanceof HTMLButtonElement && menu.contains(document.activeElement)
    ? document.activeElement
    : null;
  setRoving(menu, focused ?? buttons[0] ?? null);

  const pending = pendingFocus;
  const trigger = triggerFor(menu);
  if (pending && trigger === pending.trigger) {
    pendingFocus = null;
    const target = pending.edge === "last" ? buttons.at(-1) ?? null : buttons[0] ?? null;
    queueMicrotask(() => setRoving(menu, target, true));
  }
}

function cleanupMenu(menu: HTMLElement) {
  menu.removeAttribute("aria-orientation");
  for (const button of allMenuButtons(menu)) {
    button.removeAttribute("tabindex");
    if (button.dataset.scoutToolbarMenuRole === "1") {
      button.removeAttribute("role");
      delete button.dataset.scoutToolbarMenuRole;
    }
  }
}

function reconcile() {
  reconcileQueued = false;
  for (const menu of menus()) enhance(menu);
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function resetTypeahead() {
  typeahead = "";
  typeaheadAt = 0;
}

function label(button: HTMLButtonElement) {
  return (button.textContent ?? "").replace(/✓/g, "").trim().toLocaleLowerCase();
}

function typeaheadMatch(menu: HTMLElement, key: string) {
  const buttons = menuButtons(menu);
  if (!buttons.length) return null;
  const now = performance.now();
  if (now - typeaheadAt > TYPEAHEAD_TIMEOUT) typeahead = "";
  typeaheadAt = now;

  const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1;
  const find = (prefix: string) => {
    for (let offset = 1; offset <= buttons.length; offset += 1) {
      const index = (Math.max(current, -1) + offset) % buttons.length;
      const button = buttons[index];
      if (button && label(button).startsWith(prefix)) return button;
    }
    return null;
  };

  const next = `${typeahead}${key.toLocaleLowerCase()}`;
  const compound = find(next);
  if (compound) {
    typeahead = next;
    return compound;
  }
  typeahead = key.toLocaleLowerCase();
  return find(typeahead);
}

function moveFocus(menu: HTMLElement, delta: number) {
  const buttons = menuButtons(menu);
  if (!buttons.length) return;
  const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1;
  const index = current < 0
    ? (delta > 0 ? 0 : buttons.length - 1)
    : (current + delta + buttons.length) % buttons.length;
  setRoving(menu, buttons[index] ?? null, true);
}

function dismiss(menu: HTMLElement, event: KeyboardEvent) {
  const trigger = triggerFor(menu);
  event.preventDefault();
  event.stopImmediatePropagation();
  resetTypeahead();
  document.body.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
  }));
  window.setTimeout(() => trigger?.focus({ preventScroll: true }), 0);
}

function toolbarTrigger(target: EventTarget | null) {
  if (!(target instanceof HTMLButtonElement)) return null;
  if (!target.matches(".toolbar button[aria-haspopup='menu']")) return null;
  return target;
}

function handleKeyDown(event: KeyboardEvent) {
  const trigger = toolbarTrigger(event.target);
  if (trigger) {
    const expanded = trigger.getAttribute("aria-expanded") === "true";
    if (event.key === "Escape" && expanded) {
      const menu = activeMenu();
      if (menu) dismiss(menu, event);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    resetTypeahead();
    const edge = event.key === "ArrowUp" ? "last" : "first";
    const menu = activeMenu();
    if (expanded && menu && triggerFor(menu) === trigger) {
      const buttons = menuButtons(menu);
      setRoving(menu, edge === "last" ? buttons.at(-1) ?? null : buttons[0] ?? null, true);
      return;
    }
    pendingFocus = { trigger, edge };
    trigger.click();
    queueReconcile();
    return;
  }

  const menu = activeMenu();
  if (!menu || !(event.target instanceof Node) || !menu.contains(event.target)) return;

  if (event.key === "Escape") {
    dismiss(menu, event);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    event.stopImmediatePropagation();
    resetTypeahead();
    moveFocus(menu, 1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    event.stopImmediatePropagation();
    resetTypeahead();
    moveFocus(menu, -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    const buttons = menuButtons(menu);
    event.preventDefault();
    event.stopImmediatePropagation();
    resetTypeahead();
    setRoving(menu, event.key === "Home" ? buttons[0] ?? null : buttons.at(-1) ?? null, true);
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    event.stopImmediatePropagation();
    resetTypeahead();
    moveFocus(menu, event.shiftKey ? -1 : 1);
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && document.activeElement instanceof HTMLButtonElement && menu.contains(document.activeElement)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    resetTypeahead();
    document.activeElement.click();
    return;
  }
  if (event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const match = typeaheadMatch(menu, event.key);
    if (!match) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setRoving(menu, match, true);
  }
}

function handlePointerDown(event: PointerEvent) {
  if (!(event.target instanceof Node)) return;
  const menu = activeMenu();
  if (!menu || menu.contains(event.target)) return;
  const trigger = triggerFor(menu);
  if (trigger?.contains(event.target)) return;
  pendingFocus = null;
  resetTypeahead();
}

export function installToolbarMenuKeyboard() {
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  queueReconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    pendingFocus = null;
    resetTypeahead();
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    for (const menu of document.querySelectorAll<HTMLElement>(".view-menu, .toolbar-dropdown-menu")) cleanupMenu(menu);
  };
}

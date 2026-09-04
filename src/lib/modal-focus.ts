const MODAL_SELECTOR = '[role="dialog"], .tag-collection-backdrop > .tag-collection-panel';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

interface ModalRecord {
  dialog: HTMLElement;
  restore: HTMLElement | null;
  blockBubble: (event: KeyboardEvent) => void;
  addedRole: boolean;
  addedAriaLabel: boolean;
  previousAriaModal: string | null;
  addedTabIndex: boolean;
}

let observer: MutationObserver | null = null;
let records: ModalRecord[] = [];
let reconcileQueued = false;

function isUsable(element: HTMLElement) {
  if (!element.isConnected || element.hidden) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    if (element.disabled) return false;
  }
  return element.getClientRects().length > 0;
}

function focusables(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isUsable);
}

function topRecord() {
  return records.at(-1) ?? null;
}

function activeRestoreTarget() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.isConnected) return null;
  if (active === document.body || active === document.documentElement) return null;
  return active;
}

function focusDialog(dialog: HTMLElement) {
  if (!dialog.isConnected) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && dialog.contains(active)) return;
  const preferred = dialog.querySelector<HTMLElement>('[autofocus]');
  if (preferred && isUsable(preferred)) {
    preferred.focus({ preventScroll: true });
    return;
  }
  const first = focusables(dialog)[0];
  if (first) first.focus({ preventScroll: true });
  else dialog.focus({ preventScroll: true });
}

function closeDialog(dialog: HTMLElement) {
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const closeButton = buttons.find((button) => {
    const label = button.getAttribute('aria-label')?.trim().toLocaleLowerCase();
    const title = button.getAttribute('title')?.trim().toLocaleLowerCase();
    const text = button.textContent?.trim().toLocaleLowerCase();
    return label === 'close' || title === 'close' || text === 'close';
  });
  if (closeButton) {
    closeButton.click();
    return;
  }

  const backdrop = dialog.parentElement;
  if (!backdrop || backdrop === document.body) return;
  backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
}

function handleKeyDown(event: KeyboardEvent) {
  const record = topRecord();
  if (!record || event.isComposing) return;
  const dialog = record.dialog;
  if (!dialog.isConnected) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeDialog(dialog);
    return;
  }

  if (event.key !== 'Tab') return;
  const items = focusables(dialog);
  if (!items.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    dialog.focus({ preventScroll: true });
    return;
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const first = items[0];
  const last = items.at(-1)!;
  if (!active || !dialog.contains(active)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    event.stopImmediatePropagation();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    event.stopImmediatePropagation();
    first.focus({ preventScroll: true });
  }
}

function handleFocusIn(event: FocusEvent) {
  const record = topRecord();
  const target = event.target;
  if (!record || !(target instanceof Node) || record.dialog.contains(target)) return;
  queueMicrotask(() => focusDialog(record.dialog));
}

function restoreManagedAttributes(record: ModalRecord) {
  const { dialog } = record;
  dialog.removeEventListener('keydown', record.blockBubble);
  delete dialog.dataset.scoutModalManaged;
  if (record.addedRole) dialog.removeAttribute('role');
  if (record.addedAriaLabel) dialog.removeAttribute('aria-label');
  if (record.previousAriaModal === null) dialog.removeAttribute('aria-modal');
  else dialog.setAttribute('aria-modal', record.previousAriaModal);
  if (record.addedTabIndex) dialog.removeAttribute('tabindex');
}

function addDialog(dialog: HTMLElement, restore: HTMLElement | null) {
  const addedRole = !dialog.hasAttribute('role');
  const previousAriaModal = dialog.getAttribute('aria-modal');
  const addedTabIndex = !dialog.hasAttribute('tabindex');
  let addedAriaLabel = false;

  if (addedRole) dialog.setAttribute('role', 'dialog');
  if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
    const heading = dialog.querySelector<HTMLElement>('h1, h2, h3');
    if (heading?.textContent?.trim()) {
      dialog.setAttribute('aria-label', heading.textContent.trim());
      addedAriaLabel = true;
    }
  }
  dialog.setAttribute('aria-modal', 'true');
  if (addedTabIndex) dialog.tabIndex = -1;
  dialog.dataset.scoutModalManaged = 'true';
  const blockBubble = (event: KeyboardEvent) => event.stopPropagation();
  dialog.addEventListener('keydown', blockBubble);
  records.push({
    dialog,
    restore,
    blockBubble,
    addedRole,
    addedAriaLabel,
    previousAriaModal,
    addedTabIndex,
  });
}

function reconcile() {
  reconcileQueued = false;
  const connected = [...document.querySelectorAll<HTMLElement>(MODAL_SELECTOR)]
    .filter((dialog) => dialog.isConnected && !dialog.hidden && dialog.getAttribute('aria-hidden') !== 'true');
  const connectedSet = new Set(connected);
  const previousTop = topRecord();
  const previousRecords = new Set(records.map((record) => record.dialog));
  const removed = records.filter((record) => !connectedSet.has(record.dialog));
  for (const record of removed) restoreManagedAttributes(record);
  records = records.filter((record) => connectedSet.has(record.dialog));

  let inheritedRestore = removed.at(-1)?.restore ?? null;
  for (const dialog of connected) {
    if (records.some((record) => record.dialog === dialog)) continue;
    const active = activeRestoreTarget();
    const restore = active && !dialog.contains(active) ? active : inheritedRestore;
    addDialog(dialog, restore);
    inheritedRestore = restore;
  }

  const currentTop = topRecord();
  const addedTop = records.findLast((record) => !previousRecords.has(record.dialog)) ?? null;
  if (addedTop) {
    queueMicrotask(() => focusDialog(addedTop.dialog));
    return;
  }

  if (previousTop && !connectedSet.has(previousTop.dialog)) {
    const restore = previousTop.restore;
    if (restore?.isConnected) {
      queueMicrotask(() => restore.focus({ preventScroll: true }));
    } else if (currentTop) {
      queueMicrotask(() => focusDialog(currentTop.dialog));
    }
    return;
  }

  if (currentTop && currentTop !== previousTop) queueMicrotask(() => focusDialog(currentTop.dialog));
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

export function installModalFocusContract() {
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('focusin', handleFocusIn, true);
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'hidden', 'aria-hidden'] });
  reconcile();

  return () => {
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('focusin', handleFocusIn, true);
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    for (const record of records) restoreManagedAttributes(record);
    records = [];
  };
}

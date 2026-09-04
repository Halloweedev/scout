let observer: MutationObserver | null = null;
let pendingRestore: HTMLElement | null = null;
let pendingTimer: number | undefined;
let trackedMenu: HTMLElement | null = null;
let trackedRestore: HTMLElement | null = null;

const OPENER_SELECTOR = [
  '.toolbar button[aria-label="Back"]',
  '.toolbar button[aria-label="Forward"]',
  '.breadcrumbs .breadcrumb-sep',
  '.tab-strip > .tab',
].join(',');

function clearPending() {
  pendingRestore = null;
  if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
}

function rememberOpener(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const opener = target.closest<HTMLElement>(OPENER_SELECTOR);
  if (!opener) return;
  pendingRestore = opener;
  if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(clearPending, 3500);
}

function activeExplorerArea() {
  return document.querySelector<HTMLElement>('.explorer-pane.active .file-area');
}

function fallbackTarget() {
  return document.querySelector<HTMLElement>('.tab-strip > .tab.active')
    ?? activeExplorerArea();
}

function restoreAfterMenuClose() {
  const preferred = trackedRestore;
  trackedMenu = null;
  trackedRestore = null;
  window.setTimeout(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement
      && active.isConnected
      && active !== document.body
      && active !== document.documentElement) return;
    const target = preferred?.isConnected ? preferred : fallbackTarget();
    target?.focus({ preventScroll: true });
  }, 0);
}

function reconcileMenu() {
  const menu = document.querySelector<HTMLElement>('.ux3-navigation-menu');
  if (menu && menu !== trackedMenu) {
    trackedMenu = menu;
    trackedRestore = pendingRestore?.isConnected ? pendingRestore : null;
    clearPending();
    return;
  }
  if (!menu && trackedMenu) restoreAfterMenuClose();
}

function handlePointerDown(event: PointerEvent) {
  rememberOpener(event.target);
  if (!(event.target instanceof Element) || event.target.closest(OPENER_SELECTOR)) return;
  if (!event.target.closest('.ux3-navigation-menu')) clearPending();
}

function handleContextMenu(event: MouseEvent) {
  rememberOpener(event.target);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  rememberOpener(event.target);
}

export function installNavigationMenuFocus() {
  observer = new MutationObserver(reconcileMenu);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('contextmenu', handleContextMenu, true);
  window.addEventListener('keydown', handleKeyDown, true);
  reconcileMenu();

  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('contextmenu', handleContextMenu, true);
    window.removeEventListener('keydown', handleKeyDown, true);
    clearPending();
    trackedMenu = null;
    trackedRestore = null;
  };
}

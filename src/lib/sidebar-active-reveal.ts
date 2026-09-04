let observer: MutationObserver | null = null;
let revealFrame: number | undefined;
let lastActive: HTMLElement | null = null;

function visibleActiveDestination() {
  return [...document.querySelectorAll<HTMLElement>(".sidebar .sidebar-item.active")]
    .find((item) => item.isConnected && !item.hidden && item.offsetParent !== null && item.getAttribute("aria-hidden") !== "true")
    ?? null;
}

function needsReveal(sidebar: HTMLElement, item: HTMLElement) {
  const sidebarRect = sidebar.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const top = Math.max(sidebarRect.top, 0);
  const bottom = Math.min(sidebarRect.bottom, window.innerHeight);
  return itemRect.top < top || itemRect.bottom > bottom;
}

function revealActiveDestination() {
  revealFrame = undefined;
  const item = visibleActiveDestination();
  if (!item) {
    lastActive = null;
    return;
  }

  const changed = item !== lastActive;
  lastActive = item;
  const sidebar = item.closest<HTMLElement>(".sidebar");
  if (!sidebar || (!changed && !needsReveal(sidebar, item))) return;
  if (!needsReveal(sidebar, item)) return;

  item.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function queueReveal() {
  if (revealFrame !== undefined) return;
  revealFrame = window.requestAnimationFrame(revealActiveDestination);
}

export function installSidebarActiveReveal() {
  observer = new MutationObserver(queueReveal);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "aria-hidden"],
  });
  window.addEventListener("resize", queueReveal);
  queueReveal();

  return () => {
    observer?.disconnect();
    observer = null;
    if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
    revealFrame = undefined;
    lastActive = null;
    window.removeEventListener("resize", queueReveal);
  };
}

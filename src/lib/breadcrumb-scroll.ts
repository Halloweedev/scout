let observer: MutationObserver | null = null;
let revealQueued = false;
let dragFrame: number | null = null;
let dragTarget: HTMLElement | null = null;
let dragSpeed = 0;

const EDGE = 36;
const MAX_SPEED = 14;

function breadcrumbBars() {
  return [...document.querySelectorAll<HTMLElement>(".path-display.breadcrumbs")];
}

function revealCurrentBreadcrumb() {
  revealQueued = false;
  for (const bar of breadcrumbBars()) {
    if (bar.querySelector("input")) continue;
    const last = bar.querySelector<HTMLElement>(".breadcrumb:last-of-type");
    last?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function scheduleReveal() {
  if (revealQueued) return;
  revealQueued = true;
  requestAnimationFrame(revealCurrentBreadcrumb);
}

function handleWheel(event: WheelEvent) {
  if (!(event.target instanceof Element)) return;
  const bar = event.target.closest<HTMLElement>(".path-display.breadcrumbs");
  if (!bar || bar.querySelector("input") || bar.scrollWidth <= bar.clientWidth) return;
  const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!amount) return;
  bar.scrollLeft += amount;
  event.preventDefault();
}

function edgeSpeed(x: number, left: number, right: number) {
  const fromLeft = x - left;
  const fromRight = right - x;
  if (fromLeft >= 0 && fromLeft < EDGE) return -MAX_SPEED * (1 - fromLeft / EDGE);
  if (fromRight >= 0 && fromRight < EDGE) return MAX_SPEED * (1 - fromRight / EDGE);
  return 0;
}

function stopDragFrame() {
  if (dragFrame !== null) cancelAnimationFrame(dragFrame);
  dragFrame = null;
}

function resetDrag() {
  stopDragFrame();
  dragTarget = null;
  dragSpeed = 0;
}

function tickDrag() {
  dragFrame = null;
  if (!document.documentElement.classList.contains("internal-file-drag") || !dragTarget || !dragSpeed) {
    resetDrag();
    return;
  }
  const before = dragTarget.scrollLeft;
  dragTarget.scrollLeft += dragSpeed;
  if (dragTarget.scrollLeft !== before) dragFrame = requestAnimationFrame(tickDrag);
}

function handlePointerMove(event: PointerEvent) {
  if (!document.documentElement.classList.contains("internal-file-drag")) {
    resetDrag();
    return;
  }
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const bar = hit?.closest<HTMLElement>(".path-display.breadcrumbs") ?? null;
  if (!bar || bar.scrollWidth <= bar.clientWidth) {
    resetDrag();
    return;
  }
  const rect = bar.getBoundingClientRect();
  dragTarget = bar;
  dragSpeed = edgeSpeed(event.clientX, rect.left, rect.right);
  if (!dragSpeed) stopDragFrame();
  else if (dragFrame === null) dragFrame = requestAnimationFrame(tickDrag);
}

export function installBreadcrumbScroll() {
  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === "childList" || mutation.attributeName === "title")) scheduleReveal();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  });

  document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", resetDrag);
  window.addEventListener("pointercancel", resetDrag);
  scheduleReveal();

  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener("wheel", handleWheel, true);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", resetDrag);
    window.removeEventListener("pointercancel", resetDrag);
    revealQueued = false;
    resetDrag();
  };
}

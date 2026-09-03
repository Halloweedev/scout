const DRAG_EDGE = 38;
const DRAG_MAX_SPEED = 14;

let observer: MutationObserver | null = null;
let revealQueued = false;
let dragFrame: number | null = null;
let dragStrip: HTMLElement | null = null;
let dragSpeed = 0;

function stripFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".tab-strip");
}

function revealActiveTab() {
  revealQueued = false;
  const active = document.querySelector<HTMLElement>(".tab-strip > .tab.active");
  active?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function scheduleReveal() {
  if (revealQueued) return;
  revealQueued = true;
  requestAnimationFrame(revealActiveTab);
}

function handleWheel(event: WheelEvent) {
  const strip = stripFromTarget(event.target);
  if (!strip || strip.scrollWidth <= strip.clientWidth) return;
  const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!amount) return;
  strip.scrollLeft += amount;
  event.preventDefault();
}

function stopDragScroll() {
  if (dragFrame !== null) cancelAnimationFrame(dragFrame);
  dragFrame = null;
  dragStrip = null;
  dragSpeed = 0;
}

function dragTick() {
  dragFrame = null;
  const strip = dragStrip;
  if (!strip || !dragSpeed) return;
  const before = strip.scrollLeft;
  strip.scrollLeft += dragSpeed;
  if (strip.scrollLeft !== before) dragFrame = requestAnimationFrame(dragTick);
}

function edgeSpeed(x: number, rect: DOMRect) {
  const fromLeft = x - rect.left;
  const fromRight = rect.right - x;
  if (fromLeft >= 0 && fromLeft < DRAG_EDGE) return -DRAG_MAX_SPEED * (1 - fromLeft / DRAG_EDGE);
  if (fromRight >= 0 && fromRight < DRAG_EDGE) return DRAG_MAX_SPEED * (1 - fromRight / DRAG_EDGE);
  return 0;
}

function handlePointerMove(event: PointerEvent) {
  const draggingTabs = document.documentElement.classList.contains("ux-tab-drag-active");
  const draggingFiles = document.documentElement.classList.contains("internal-file-drag");
  if (!draggingTabs && !draggingFiles) {
    stopDragScroll();
    return;
  }

  const strip = document.querySelector<HTMLElement>(".tab-strip");
  if (!strip || strip.scrollWidth <= strip.clientWidth) {
    stopDragScroll();
    return;
  }

  const rect = strip.getBoundingClientRect();
  const withinVerticalBand = event.clientY >= rect.top - 8 && event.clientY <= rect.bottom + 8;
  if (!withinVerticalBand) {
    stopDragScroll();
    return;
  }

  const nextSpeed = edgeSpeed(event.clientX, rect);
  if (!nextSpeed) {
    stopDragScroll();
    return;
  }

  dragStrip = strip;
  dragSpeed = nextSpeed;
  if (dragFrame === null) dragFrame = requestAnimationFrame(dragTick);
}

export function installTabScroll() {
  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === "childList" || mutation.attributeName === "class")) scheduleReveal();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopDragScroll);
  window.addEventListener("pointercancel", stopDragScroll);
  scheduleReveal();

  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener("wheel", handleWheel, true);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopDragScroll);
    window.removeEventListener("pointercancel", stopDragScroll);
    stopDragScroll();
    revealQueued = false;
  };
}

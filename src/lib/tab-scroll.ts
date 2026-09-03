let observer: MutationObserver | null = null;
let revealQueued = false;

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
  scheduleReveal();

  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener("wheel", handleWheel, true);
    revealQueued = false;
  };
}

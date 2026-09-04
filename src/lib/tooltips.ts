const CANDIDATE_SELECTOR = [
  "button",
  "a[href]",
  '[role="button"]',
  '[role="tab"]',
  '[role="separator"]',
  '[tabindex]:not([tabindex="-1"])',
  "[data-scout-tooltip]",
].join(",");

const POINTER_DELAY_MS = 460;
const KEYBOARD_DELAY_MS = 140;
const WARM_DELAY_MS = 55;
const WARM_WINDOW_MS = 700;
const EDGE_GAP = 8;
const TARGET_GAP = 7;

interface TooltipCopy {
  text: string;
  source: "custom" | "title" | "label";
}

let tooltip: HTMLDivElement | null = null;
let scheduledTarget: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;
let showTimer: number | undefined;
let warmUntil = 0;
let keyboardIntentUntil = 0;
let pointerHeld = false;
const suppressedTitles = new Map<HTMLElement, string>();

function visibleText(element: HTMLElement) {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isCompactControl(element: HTMLElement) {
  if (element.getAttribute("role") === "separator") return true;
  const text = visibleText(element);
  if (!text) return true;
  if (text.length <= 2) return true;
  return false;
}

function candidateFrom(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const candidate = target.closest<HTMLElement>(CANDIDATE_SELECTOR);
  if (!candidate || !candidate.isConnected) return null;
  if (candidate.closest("[aria-hidden='true']")) return null;
  return candidate;
}

function readCopy(element: HTMLElement): TooltipCopy | null {
  const custom = element.dataset.scoutTooltip?.trim();
  if (custom) return { text: custom, source: "custom" };

  const title = element.getAttribute("title")?.trim() || suppressedTitles.get(element)?.trim();
  if (title) return { text: title, source: "title" };

  const label = element.getAttribute("aria-label")?.trim();
  if (label && isCompactControl(element)) return { text: label, source: "label" };
  return null;
}

function suppressNativeTitle(element: HTMLElement) {
  const title = element.getAttribute("title");
  if (title === null) return;
  suppressedTitles.set(element, title);
  element.removeAttribute("title");
}

function restoreNativeTitle(element: HTMLElement) {
  const title = suppressedTitles.get(element);
  if (title === undefined) return;
  suppressedTitles.delete(element);
  if (!element.hasAttribute("title")) element.setAttribute("title", title);
}

function ensureTooltip() {
  if (tooltip) return tooltip;
  tooltip = document.createElement("div");
  tooltip.className = "scout-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);
  return tooltip;
}

function clearTimer() {
  if (showTimer !== undefined) window.clearTimeout(showTimer);
  showTimer = undefined;
}

function positionTooltip(target: HTMLElement) {
  if (!tooltip || tooltip.hidden) return;
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
  left = Math.max(EDGE_GAP, Math.min(left, window.innerWidth - EDGE_GAP - tooltipRect.width));

  const below = targetRect.bottom + TARGET_GAP;
  const above = targetRect.top - TARGET_GAP - tooltipRect.height;
  const useAbove = below + tooltipRect.height > window.innerHeight - EDGE_GAP && above >= EDGE_GAP;
  const top = useAbove
    ? above
    : Math.max(EDGE_GAP, Math.min(below, window.innerHeight - EDGE_GAP - tooltipRect.height));

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.dataset.placement = useAbove ? "top" : "bottom";
}

function hideTooltip(options: { restoreTitle?: boolean; keepWarm?: boolean } = {}) {
  clearTimer();
  const target = activeTarget ?? scheduledTarget;
  scheduledTarget = null;
  activeTarget = null;
  if (tooltip) {
    tooltip.hidden = true;
    tooltip.classList.remove("visible");
    tooltip.removeAttribute("data-placement");
  }
  if (target && options.restoreTitle !== false) restoreNativeTitle(target);
  if (options.keepWarm !== false) warmUntil = performance.now() + WARM_WINDOW_MS;
}

function showTooltip(target: HTMLElement) {
  showTimer = undefined;
  if (!target.isConnected || pointerHeld) {
    restoreNativeTitle(target);
    scheduledTarget = null;
    return;
  }
  const copy = readCopy(target);
  if (!copy) {
    restoreNativeTitle(target);
    scheduledTarget = null;
    return;
  }

  const node = ensureTooltip();
  node.textContent = copy.text;
  node.hidden = false;
  node.classList.add("visible");
  activeTarget = target;
  scheduledTarget = null;
  positionTooltip(target);
}

function scheduleTooltip(target: HTMLElement, modality: "pointer" | "keyboard") {
  if (pointerHeld || target === activeTarget || target === scheduledTarget) return;
  const copy = readCopy(target);
  if (!copy) return;

  if (activeTarget || scheduledTarget) hideTooltip({ keepWarm: true });
  suppressNativeTitle(target);
  scheduledTarget = target;

  const delay = modality === "keyboard"
    ? KEYBOARD_DELAY_MS
    : performance.now() < warmUntil
      ? WARM_DELAY_MS
      : POINTER_DELAY_MS;
  showTimer = window.setTimeout(() => showTooltip(target), delay);
}

function onPointerOver(event: PointerEvent) {
  if (event.pointerType === "touch" || pointerHeld) return;
  const target = candidateFrom(event.target);
  if (!target) return;
  const previous = candidateFrom(event.relatedTarget);
  if (previous === target) return;
  scheduleTooltip(target, "pointer");
}

function onPointerOut(event: PointerEvent) {
  const target = candidateFrom(event.target);
  if (!target) return;
  const next = candidateFrom(event.relatedTarget);
  if (next === target) return;
  if (target === activeTarget || target === scheduledTarget) hideTooltip({ keepWarm: true });
  restoreNativeTitle(target);
}

function onPointerDown() {
  pointerHeld = true;
  keyboardIntentUntil = 0;
  hideTooltip({ restoreTitle: false, keepWarm: false });
}

function onPointerRelease() {
  pointerHeld = false;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    hideTooltip({ restoreTitle: false, keepWarm: false });
    return;
  }
  if (["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    keyboardIntentUntil = performance.now() + 1200;
  }
}

function onFocusIn(event: FocusEvent) {
  if (performance.now() > keyboardIntentUntil) return;
  const target = candidateFrom(event.target);
  if (target) scheduleTooltip(target, "keyboard");
}

function onFocusOut(event: FocusEvent) {
  const target = candidateFrom(event.target);
  if (!target) return;
  if (target === activeTarget || target === scheduledTarget) hideTooltip({ restoreTitle: false, keepWarm: false });
  restoreNativeTitle(target);
}

function onViewportChange() {
  hideTooltip({ restoreTitle: false, keepWarm: false });
}

function onMutations() {
  const target = activeTarget ?? scheduledTarget;
  if (target && !target.isConnected) {
    hideTooltip({ restoreTitle: false, keepWarm: false });
    restoreNativeTitle(target);
  }
  for (const element of [...suppressedTitles.keys()]) {
    if (!element.isConnected) restoreNativeTitle(element);
  }
}

export function installTooltips() {
  const observer = new MutationObserver(onMutations);
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("pointerover", onPointerOver, true);
  window.addEventListener("pointerout", onPointerOut, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerRelease, true);
  window.addEventListener("pointercancel", onPointerRelease, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("focusin", onFocusIn, true);
  window.addEventListener("focusout", onFocusOut, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);

  return () => {
    observer.disconnect();
    window.removeEventListener("pointerover", onPointerOver, true);
    window.removeEventListener("pointerout", onPointerOut, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerRelease, true);
    window.removeEventListener("pointercancel", onPointerRelease, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("focusin", onFocusIn, true);
    window.removeEventListener("focusout", onFocusOut, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
    hideTooltip({ restoreTitle: false, keepWarm: false });
    for (const element of [...suppressedTitles.keys()]) restoreNativeTitle(element);
    tooltip?.remove();
    tooltip = null;
    scheduledTarget = null;
    activeTarget = null;
    pointerHeld = false;
    keyboardIntentUntil = 0;
    warmUntil = 0;
  };
}

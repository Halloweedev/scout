const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
const OPEN_TIMEOUT_MS = 900;

function tabElements() {
  return [...document.querySelectorAll<HTMLElement>(".tab-strip > .tab")];
}

function activePanePath() {
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function samePath(a: string, b: string) {
  const normalize = (value: string) => {
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  return normalize(a) === normalize(b);
}

function dispatchNewTabShortcut() {
  if (!document.querySelector(".tab-strip > .tab.active")) return false;
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "t",
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
    cancelable: true,
  }));
  return true;
}

export function requestNewTab() {
  return dispatchNewTabShortcut();
}

export function requestOpenTab(path: string) {
  const destination = path.trim();
  if (!destination) return false;

  const beforeCount = tabElements().length;
  if (!beforeCount || !dispatchNewTabShortcut()) return false;

  let settled = false;
  let observer: MutationObserver | null = null;
  let timeout: number | undefined;

  const cleanup = () => {
    observer?.disconnect();
    observer = null;
    if (timeout !== undefined) window.clearTimeout(timeout);
    timeout = undefined;
  };

  const finish = () => {
    if (settled || tabElements().length <= beforeCount) return false;
    settled = true;
    cleanup();
    const current = activePanePath();
    if (!current || !samePath(current, destination)) {
      window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: destination } }));
    }
    return true;
  };

  queueMicrotask(finish);
  if (settled) return true;

  observer = new MutationObserver(finish);
  const strip = document.querySelector<HTMLElement>(".tab-strip");
  if (strip) observer.observe(strip, { childList: true });
  timeout = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    window.dispatchEvent(new CustomEvent("scout:toast", {
      detail: { message: "Could not open the new tab", error: true },
    }));
  }, OPEN_TIMEOUT_MS);
  return true;
}

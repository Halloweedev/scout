function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
}

function breadcrumbPath(button: HTMLElement) {
  const display = button.closest<HTMLElement>(".path-display.breadcrumbs");
  const panePath = document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? display?.title ?? "";
  if (!display || !panePath) return null;
  const buttons = [...display.querySelectorAll<HTMLElement>(".breadcrumb")];
  const index = buttons.indexOf(button);
  if (index < 0) return null;

  const normalized = panePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (index >= parts.length) return null;
  const drive = /^[a-zA-Z]:/.exec(normalized)?.[0] ?? null;
  const unc = panePath.startsWith("\\\\");
  const unixAbsolute = !drive && !unc && normalized.startsWith("/");

  if (drive) {
    const rest = parts.slice(1, index + 1);
    return rest.length ? `${drive}\\${rest.join("\\")}` : `${drive}\\`;
  }
  if (unc) return `\\\\${parts.slice(0, index + 1).join("\\")}`;
  return `${unixAbsolute ? "/" : ""}${parts.slice(0, index + 1).join("/")}`;
}

function destinationFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;

  const breadcrumb = target.closest<HTMLElement>(".breadcrumb");
  if (breadcrumb) return breadcrumbPath(breadcrumb);

  const sidebar = target.closest<HTMLElement>(".sidebar-item[data-scout-drop-path]");
  if (!sidebar || sidebar.dataset.scoutDropAction === "trash") return null;
  return sidebar.dataset.scoutDropPath ?? null;
}

function openInNewTab(path: string) {
  const current = document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath;
  if (current && comparablePath(current) === comparablePath(path)) {
    // Opening the current location in another tab is still useful, so keep the normal flow.
  }
  const button = document.querySelector<HTMLElement>(".tab-strip > .new-tab-button");
  if (!button) return false;
  button.click();
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path } }));
  });
  return true;
}

function handleAuxClick(event: MouseEvent) {
  if (event.button !== 1) return;
  const path = destinationFromTarget(event.target);
  if (!path || !openInNewTab(path)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleClick(event: MouseEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
  const path = destinationFromTarget(event.target);
  if (!path || !openInNewTab(path)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function installNavigationGestures() {
  document.addEventListener("auxclick", handleAuxClick, true);
  document.addEventListener("click", handleClick, true);

  return () => {
    document.removeEventListener("auxclick", handleAuxClick, true);
    document.removeEventListener("click", handleClick, true);
  };
}

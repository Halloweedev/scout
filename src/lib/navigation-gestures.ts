import { requestOpenTab } from "./tab-commands";

const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

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

function handleAuxClick(event: MouseEvent) {
  if (event.button !== 1) return;
  const path = destinationFromTarget(event.target);
  if (!path || !requestOpenTab(path)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleClick(event: MouseEvent) {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (!modifier || event.shiftKey || event.altKey || (isMac && event.ctrlKey)) return;
  const path = destinationFromTarget(event.target);
  if (!path || !requestOpenTab(path)) return;
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

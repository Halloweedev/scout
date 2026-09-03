const STORAGE_KEY = "scout.sidebar-sections.v1";

let observer: MutationObserver | null = null;
let reconcileQueued = false;

function sectionKey(label: HTMLElement) {
  return (label.textContent ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readCollapsed() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === "string" && !!value));
  } catch {
    return new Set<string>();
  }
}

function writeCollapsed(collapsed: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed].sort()));
}

function isBoundary(node: Element) {
  return node.matches(".sidebar-section-label, .sidebar-section-heading")
    || !!node.querySelector(":scope > .sidebar-section-label, :scope > .sidebar-section-heading");
}

function sectionNodes(label: HTMLElement) {
  const heading = label.closest<HTMLElement>(".sidebar-section-heading");
  const anchor = heading ?? label;
  const parent = anchor.parentElement;
  if (!parent) return [] as HTMLElement[];

  const sidebar = label.closest<HTMLElement>(".sidebar");
  const nodes: HTMLElement[] = [];
  let next = anchor.nextElementSibling;

  // Dynamically injected sections (Power, Activity, Tags) own their wrapper, so
  // everything after the label inside that wrapper belongs to the section.
  if (parent !== sidebar && !heading) {
    while (next) {
      if (next instanceof HTMLElement) nodes.push(next);
      next = next.nextElementSibling;
    }
    return nodes;
  }

  // Static App sections live directly in the sidebar. Their content continues
  // until the next section heading/label or a dynamic section wrapper.
  while (next) {
    if (isBoundary(next)) break;
    if (next instanceof HTMLElement) nodes.push(next);
    next = next.nextElementSibling;
  }
  return nodes;
}

function setCollapsed(label: HTMLElement, collapsed: boolean, persist = false) {
  const key = sectionKey(label);
  if (!key) return;

  label.dataset.scoutSidebarSection = key;
  label.setAttribute("aria-expanded", collapsed ? "false" : "true");
  label.classList.toggle("scout-sidebar-section-collapsed", collapsed);
  label.closest<HTMLElement>(".sidebar-section-heading")?.classList.toggle("scout-sidebar-section-collapsed", collapsed);

  for (const node of sectionNodes(label)) {
    node.classList.add("scout-sidebar-section-content");
    node.hidden = collapsed;
  }

  if (persist) {
    const state = readCollapsed();
    if (collapsed) state.add(key);
    else state.delete(key);
    writeCollapsed(state);
  }
}

function toggle(label: HTMLElement, force?: boolean) {
  const collapsed = force ?? label.getAttribute("aria-expanded") !== "false";
  setCollapsed(label, collapsed, true);
}

function enhanceLabel(label: HTMLElement) {
  const key = sectionKey(label);
  if (!key) return;

  if (label.dataset.scoutSidebarDisclosure !== "1") {
    label.dataset.scoutSidebarDisclosure = "1";
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    label.setAttribute("aria-label", `${label.textContent?.trim() || "Sidebar"} section`);
    label.title = "Click to collapse or expand";

    label.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle(label);
    });

    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        toggle(label);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        toggle(label, true);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        toggle(label, false);
      }
    });
  }

  setCollapsed(label, readCollapsed().has(key));
}

function reconcile() {
  reconcileQueued = false;
  for (const label of document.querySelectorAll<HTMLElement>(".sidebar .sidebar-section-label")) {
    enhanceLabel(label);
  }
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

export function installSidebarDisclosure() {
  reconcile();
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    for (const label of document.querySelectorAll<HTMLElement>(".sidebar .sidebar-section-label[data-scout-sidebar-disclosure]")) {
      label.removeAttribute("role");
      label.removeAttribute("tabindex");
      label.removeAttribute("aria-expanded");
      label.removeAttribute("aria-label");
      label.removeAttribute("title");
      label.classList.remove("scout-sidebar-section-collapsed");
      delete label.dataset.scoutSidebarDisclosure;
      delete label.dataset.scoutSidebarSection;
    }
    for (const node of document.querySelectorAll<HTMLElement>(".scout-sidebar-section-content")) {
      node.hidden = false;
      node.classList.remove("scout-sidebar-section-content");
    }
    document.querySelectorAll(".sidebar-section-heading.scout-sidebar-section-collapsed")
      .forEach((node) => node.classList.remove("scout-sidebar-section-collapsed"));
  };
}

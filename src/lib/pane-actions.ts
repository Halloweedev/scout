import { registerActions } from "./actions";

const WAIT_TIMEOUT_MS = 1800;

function paneCount() {
  return document.querySelectorAll(".explorer-pane").length;
}

function toolbarMoreTrigger() {
  return document.querySelector<HTMLButtonElement>('.toolbar-more button[aria-label="More options"]');
}

function normalizeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

async function waitFor(predicate: () => boolean, timeout = WAIT_TIMEOUT_MS) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    if (predicate()) return true;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 18));
  }
  return predicate();
}

async function toolbarMenuItem(label: string) {
  const trigger = toolbarMoreTrigger();
  if (!trigger) throw new Error("More options is not available");

  if (trigger.getAttribute("aria-expanded") !== "true") {
    trigger.click();
    await waitFor(() => !!document.querySelector(".toolbar-more .toolbar-dropdown-menu"), 500);
  }

  const expected = normalizeLabel(label);
  const item = [...document.querySelectorAll<HTMLButtonElement>(".toolbar-more .toolbar-dropdown-menu button")]
    .find((button) => normalizeLabel(button.textContent ?? "").startsWith(expected)) ?? null;
  if (!item) throw new Error(`${label} is not available`);
  return item;
}

async function addPaneThroughOwner() {
  const before = paneCount();
  if (before >= 4) throw new Error("Scout supports up to four panes");
  const item = await toolbarMenuItem("Add pane");
  if (item.disabled) throw new Error("Add Pane is not available");
  item.click();
  if (!await waitFor(() => paneCount() === before + 1)) throw new Error("Scout could not add the pane");
}

async function closeActivePaneThroughOwner() {
  const before = paneCount();
  if (before <= 1) throw new Error("Scout must keep at least one pane open");
  const close = document.querySelector<HTMLButtonElement>(".explorer-pane.active .pane-close-button");
  if (!close || close.disabled) throw new Error("Close Pane is not available");
  close.click();
  if (!await waitFor(() => paneCount() === before - 1)) throw new Error("Scout could not close the pane");
}

async function toggleLinkedPanesThroughOwner() {
  const item = await toolbarMenuItem("Linked panes");
  if (item.disabled) throw new Error("Linked Panes is not available");
  item.click();
}

export function installPaneActions() {
  return registerActions([
    {
      id: "workspace.add-pane",
      title: "Add Pane",
      category: "Workspace",
      keywords: ["split", "pane", "dual", "multi pane"],
      available: () => paneCount() > 0 && paneCount() < 4,
      run: addPaneThroughOwner,
    },
    {
      id: "workspace.close-pane",
      title: "Close Active Pane",
      category: "Workspace",
      keywords: ["remove", "split", "pane"],
      available: () => paneCount() > 1,
      run: closeActivePaneThroughOwner,
    },
    {
      id: "workspace.toggle-linked-panes",
      title: "Toggle Linked Panes",
      category: "Workspace",
      keywords: ["sync", "linked", "pane", "navigation"],
      available: () => paneCount() > 1,
      run: toggleLinkedPanesThroughOwner,
    },
  ]);
}

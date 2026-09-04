const TYPEAHEAD_TIMEOUT_MS = 650;
const RESTORE_DELAY_MS = 48;

interface SelectionSnapshot {
  panePath: string;
  selectedPaths: string[];
  cursorPath: string | null;
  cursorIndex: number;
}

let typeahead = "";
let typeaheadTimer: number | undefined;
let restoreTimer: number | undefined;
let lastSnapshot: SelectionSnapshot | null = null;
let cursorPath: string | null = null;

function isMacPlatform() {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function appNeedsEditorShield(target: EventTarget | null) {
  return target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function keyboardTarget(event: KeyboardEvent) {
  return event.target instanceof Element
    ? event.target
    : document.activeElement instanceof Element ? document.activeElement : null;
}

function embeddedFileControl(target: Element | null) {
  if (!target) return false;
  if (target.closest(".pane-file-row[data-entry-path]")) return false;
  return !!target.closest("input, textarea, select, button, a[href], [contenteditable='true'], [role='button'], [role='separator'], [role='menuitem']");
}

function activeFileSurfaceOwnsFocus(event: KeyboardEvent) {
  if (!event.isTrusted) return true;
  const target = keyboardTarget(event);
  if (!target) return false;
  const pane = target.closest<HTMLElement>(".explorer-pane");
  if (!pane?.classList.contains("active")) return false;
  if (!target.closest(".file-area, .column-browser-list")) return false;
  return !embeddedFileControl(target);
}

function activePane() {
  return document.querySelector<HTMLElement>(".explorer-pane.active");
}

function panePath(pane = activePane()) {
  return pane?.dataset.panePath ?? "";
}

function columnsMode() {
  return !!document.querySelector(".pane-grid.view-columns");
}

function visibleRows() {
  const pane = activePane();
  if (!pane) return [] as HTMLElement[];

  const scope = columnsMode()
    ? pane.querySelector<HTMLElement>(".column-browser-column.focused .column-browser-list")
    : pane.querySelector<HTMLElement>(".file-area");
  if (!scope) return [] as HTMLElement[];

  return Array.from(scope.querySelectorAll<HTMLElement>(".pane-file-row"))
    .filter((row) => row.offsetParent !== null && !!row.dataset.entryPath);
}

function selectedRows(rows = visibleRows()) {
  return rows.filter((row) => row.classList.contains("selected"));
}

function rowIndex(row: HTMLElement | null) {
  if (!row) return -1;
  const value = Number(row.dataset.entryIndex);
  return Number.isFinite(value) ? value : -1;
}

function currentRow(rows = visibleRows()) {
  if (!rows.length) return null;
  if (cursorPath) {
    const cursor = rows.find((row) => row.dataset.entryPath === cursorPath);
    if (cursor) return cursor;
  }
  const selected = selectedRows(rows);
  return selected.at(-1) ?? selected[0] ?? null;
}

function markCursor(row: HTMLElement | null) {
  document.querySelectorAll<HTMLElement>('.pane-file-row[data-ux-cursor="true"]')
    .forEach((candidate) => candidate.removeAttribute("data-ux-cursor"));
  if (!row) {
    cursorPath = null;
    return;
  }
  row.dataset.uxCursor = "true";
  cursorPath = row.dataset.entryPath ?? null;
}

function dispatchSelectionClick(row: HTMLElement, options: { shift?: boolean; additive?: boolean } = {}) {
  const mac = isMacPlatform();
  row.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
    shiftKey: !!options.shift,
    metaKey: !!options.additive && mac,
    ctrlKey: !!options.additive && !mac,
  }));
  markCursor(row);
  row.scrollIntoView({ block: "nearest", inline: "nearest" });
  window.setTimeout(captureSelectionSnapshot, 0);
}

function spatialNeighbor(rows: HTMLElement[], current: HTMLElement, direction: "left" | "right" | "up" | "down") {
  const source = current.getBoundingClientRect();
  const sx = source.left + source.width / 2;
  const sy = source.top + source.height / 2;
  let best: { row: HTMLElement; score: number } | null = null;

  for (const row of rows) {
    if (row === current) continue;
    const rect = row.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - sx;
    const dy = y - sy;
    const valid = direction === "left" ? dx < -2
      : direction === "right" ? dx > 2
        : direction === "up" ? dy < -2
          : dy > 2;
    if (!valid) continue;
    const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.2;
    if (!best || score < best.score) best = { row, score };
  }

  return best?.row ?? null;
}

function moveRangeSelection(event: KeyboardEvent) {
  if (!event.shiftKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return false;
  const rows = visibleRows();
  if (!rows.length) return false;

  if (columnsMode() && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return false;

  const current = currentRow(rows) ?? rows[0];
  let next: HTMLElement | null = null;

  if (!columnsMode() && document.querySelector(".pane-grid.view-icons, .pane-grid.view-gallery")) {
    next = spatialNeighbor(rows, current, event.key.replace("Arrow", "").toLowerCase() as "left" | "right" | "up" | "down");
  } else {
    const index = Math.max(0, rows.indexOf(current));
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!delta) return false;
    next = rows[Math.min(Math.max(index + delta, 0), rows.length - 1)] ?? null;
  }

  if (!next || next === current) return true;
  event.preventDefault();
  event.stopImmediatePropagation();
  dispatchSelectionClick(next, { shift: true });
  return true;
}

function jumpSelection(event: KeyboardEvent) {
  if (!["Home", "End"].includes(event.key)) return false;
  const rows = visibleRows();
  if (!rows.length) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = event.key === "Home" ? rows[0] : rows[rows.length - 1];
  dispatchSelectionClick(target, { shift: event.shiftKey });
  return true;
}

function handleMacReturnRename(event: KeyboardEvent) {
  if (!isMacPlatform() || event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (!selectedRows().length) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.setTimeout(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
  }, 0);
  return true;
}

function handleTypeahead(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.key.length !== 1 || !/^[a-z0-9._-]$/i.test(event.key)) return false;
  const rows = visibleRows();
  if (!rows.length) return false;

  typeahead += event.key.toLowerCase();
  if (typeaheadTimer !== undefined) window.clearTimeout(typeaheadTimer);
  typeaheadTimer = window.setTimeout(() => { typeahead = ""; typeaheadTimer = undefined; }, TYPEAHEAD_TIMEOUT_MS);

  const current = currentRow(rows);
  const start = current ? rows.indexOf(current) + 1 : 0;
  const ordered = [...rows.slice(start), ...rows.slice(0, start)];
  const match = ordered.find((row) => (row.dataset.entryName ?? "").toLowerCase().startsWith(typeahead));
  if (!match) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  dispatchSelectionClick(match);
  return true;
}

function captureSelectionSnapshot() {
  const pane = activePane();
  if (!pane) {
    lastSnapshot = null;
    return;
  }
  const rows = visibleRows();
  const selected = selectedRows(rows);
  if (!selected.length) return;
  const cursor = currentRow(rows) ?? selected[selected.length - 1];
  lastSnapshot = {
    panePath: panePath(pane),
    selectedPaths: selected.map((row) => row.dataset.entryPath!).filter(Boolean),
    cursorPath: cursor?.dataset.entryPath ?? null,
    cursorIndex: Math.max(0, rows.indexOf(cursor)),
  };
  markCursor(cursor);
}

function restoreSelectionAfterMutation() {
  if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(() => {
    restoreTimer = undefined;
    const snapshot = lastSnapshot;
    const pane = activePane();
    if (!snapshot || !pane || snapshot.panePath !== panePath(pane)) return;
    const rows = visibleRows();
    if (!rows.length) return;
    if (selectedRows(rows).length) {
      captureSelectionSnapshot();
      return;
    }

    const surviving = snapshot.selectedPaths
      .map((path) => rows.find((row) => row.dataset.entryPath === path))
      .find((row): row is HTMLElement => !!row);
    const fallback = rows[Math.min(snapshot.cursorIndex, rows.length - 1)] ?? rows.at(-1) ?? null;
    const target = surviving ?? fallback;
    if (target) dispatchSelectionClick(target);
  }, RESTORE_DELAY_MS);
}

function syncAccessibility() {
  const pane = activePane();
  if (!pane) return;
  const area = columnsMode()
    ? pane.querySelector<HTMLElement>(".column-browser-column.focused .column-browser-list")
    : pane.querySelector<HTMLElement>(".file-area");
  if (area) {
    area.setAttribute("role", "listbox");
    area.setAttribute("aria-multiselectable", "true");
  }
  for (const row of visibleRows()) {
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", row.classList.contains("selected") ? "true" : "false");
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (isEditableTarget(event.target)) return;
  if (!activeFileSurfaceOwnsFocus(event)) return;
  if (event.key === "Escape" && !document.querySelector(".quick-look-backdrop")) {
    lastSnapshot = null;
    markCursor(null);
  }
  if (document.querySelector(".quick-look-backdrop") && event.code === "Space") return;
  if (handleMacReturnRename(event)) return;
  if (moveRangeSelection(event)) return;
  if (jumpSelection(event)) return;
  handleTypeahead(event);
}

function shouldShieldAppEditorKey(event: KeyboardEvent) {
  if (!event.isTrusted || !appNeedsEditorShield(event.target)) return false;
  const modifier = event.metaKey || event.ctrlKey;
  return !(modifier && event.key.toLocaleLowerCase() === "l");
}

function shouldShieldAppFileKey(event: KeyboardEvent) {
  if (!event.isTrusted || activeFileSurfaceOwnsFocus(event)) return false;
  if (isEditableTarget(event.target)) return false;

  if (event.key === "F2" || event.key === "Delete" || event.key === "Enter" || event.key === "Escape") return true;
  if (isMacPlatform() && event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Backspace") return true;
  if (!event.metaKey && !event.ctrlKey && !event.altKey
    && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return true;
  return false;
}

function handleChromeKeyDown(event: KeyboardEvent) {
  // Match App's editor ownership for controls it does not natively recognize,
  // then shield trusted physical file keys that originated from chrome. Do not
  // preventDefault: target controls retain their native keyboard behavior.
  if (shouldShieldAppEditorKey(event) || shouldShieldAppFileKey(event)) event.stopPropagation();
}

function handlePointerDown(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest<HTMLElement>(".pane-file-row") ?? null;
  const area = target?.closest<HTMLElement>(".file-area, .column-browser-list") ?? null;
  if (row) {
    if (area && !embeddedFileControl(target)) area.focus({ preventScroll: true });
    cursorPath = row.dataset.entryPath ?? null;
    return;
  }
  if (area && !embeddedFileControl(target)) {
    area.focus({ preventScroll: true });
    lastSnapshot = null;
    markCursor(null);
  }
}

function handleInteractionComplete() {
  window.setTimeout(() => {
    captureSelectionSnapshot();
    syncAccessibility();
  }, 0);
}

export function installUxInteractions() {
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keydown", handleChromeKeyDown);
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("click", handleInteractionComplete);
  document.addEventListener("contextmenu", handleInteractionComplete);
  window.addEventListener("keyup", handleInteractionComplete);

  const observer = new MutationObserver(() => {
    syncAccessibility();
    restoreSelectionAfterMutation();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  syncAccessibility();
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keydown", handleChromeKeyDown);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("click", handleInteractionComplete);
    document.removeEventListener("contextmenu", handleInteractionComplete);
    window.removeEventListener("keyup", handleInteractionComplete);
    observer.disconnect();
    if (typeaheadTimer !== undefined) window.clearTimeout(typeaheadTimer);
    if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    document.querySelectorAll<HTMLElement>('[data-ux-cursor="true"]').forEach((node) => node.removeAttribute("data-ux-cursor"));
  };
}

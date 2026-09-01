import { invoke } from "@tauri-apps/api/core";
import { openEntry } from "./fs";

const INDEX_VERSION = 2;

interface IndexStatus {
  count: number;
  root: string | null;
  lastIndexedMs: number | null;
  version: number;
}

interface SearchResult {
  path: string;
  name: string;
  parent: string;
  kind: string;
  extension: string | null;
  score: number;
  matchContext: string | null;
}

const indexStatus = () => invoke<IndexStatus>("index_status");
const rebuildIndex = (root: string | null = null) => invoke<IndexStatus>("rebuild_index", { root });
const searchIndex = (query: string, limit = 40) => invoke<SearchResult[]>("search_index", { query, limit });
const recordIndexOpen = (path: string) => invoke<void>("record_index_open", { path });

let overlay: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let resultsNode: HTMLDivElement | null = null;
let footerStatus: HTMLSpanElement | null = null;
let results: SearchResult[] = [];
let selectedIndex = 0;
let searchToken = 0;
let searchTimer: number | undefined;
let indexingPromise: Promise<IndexStatus> | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setStatus(value: string) {
  if (footerStatus) footerStatus.textContent = value;
}

async function ensureIndex() {
  if (indexingPromise) return indexingPromise;
  const status = await indexStatus();
  if (status.count > 0 && status.version >= INDEX_VERSION) return status;

  setStatus(status.count > 0 ? "Upgrading local index…" : "Building local index…");
  indexingPromise = rebuildIndex().finally(() => {
    indexingPromise = null;
  });
  const rebuilt = await indexingPromise;
  setStatus(`${rebuilt.count.toLocaleString()} indexed`);
  return rebuilt;
}

function iconFor(result: SearchResult) {
  const glyph = element("span", `global-search-glyph ${result.kind}`);
  glyph.setAttribute("aria-hidden", "true");
  return glyph;
}

function renderResults() {
  if (!resultsNode) return;
  resultsNode.replaceChildren();
  if (results.length === 0) {
    const empty = element("div", "global-search-empty");
    empty.textContent = input?.value.trim() ? "No matching files or contents." : "Type to search your files.";
    resultsNode.append(empty);
    return;
  }

  results.forEach((result, index) => {
    const row = element("button", "global-search-result");
    row.type = "button";
    row.classList.toggle("selected", index === selectedIndex);
    row.dataset.resultIndex = String(index);

    const text = element("span", "global-search-result-text");
    const name = element("span", "global-search-result-name");
    name.textContent = result.name;
    const context = element("span", result.matchContext ? "global-search-result-path content-match" : "global-search-result-path");
    context.textContent = result.matchContext ?? result.parent;
    text.append(name, context);

    const type = element("span", "global-search-result-type");
    type.textContent = result.matchContext
      ? "Content"
      : result.kind === "directory"
        ? "Folder"
        : (result.extension?.toUpperCase() ?? "File");

    row.append(iconFor(result), text, type);
    row.addEventListener("pointermove", () => {
      if (selectedIndex !== index) {
        selectedIndex = index;
        renderResults();
      }
    });
    row.addEventListener("click", () => void activateResult(index));
    resultsNode?.append(row);
  });

  resultsNode.querySelector<HTMLElement>(`.global-search-result[data-result-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
}

async function runSearch(query = input?.value ?? "") {
  const token = ++searchToken;
  try {
    const status = await ensureIndex();
    if (token !== searchToken || !overlay) return;
    setStatus(`${status.count.toLocaleString()} indexed · names, paths & contents`);
    const next = await searchIndex(query, 40);
    if (token !== searchToken || !overlay) return;
    results = next;
    selectedIndex = 0;
    renderResults();
  } catch (error) {
    if (token !== searchToken) return;
    results = [];
    renderResults();
    setStatus(String(error));
  }
}

function scheduleSearch() {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    void runSearch();
  }, 70);
}

async function activateResult(index = selectedIndex) {
  const result = results[index];
  if (!result) return;
  closePalette();
  void recordIndexOpen(result.path).catch(() => {});
  if (result.kind === "directory") {
    window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: result.path } }));
  } else {
    await openEntry(result.path);
  }
}

function moveSelection(delta: number) {
  if (!results.length) return;
  selectedIndex = (selectedIndex + delta + results.length) % results.length;
  renderResults();
}

function closePalette() {
  searchToken += 1;
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = undefined;
  overlay?.remove();
  overlay = null;
  input = null;
  resultsNode = null;
  footerStatus = null;
  results = [];
  selectedIndex = 0;
}

function openPalette() {
  if (overlay) {
    input?.focus();
    return;
  }

  overlay = element("div", "global-search-backdrop");
  const palette = element("section", "global-search-palette");
  const inputRow = element("div", "global-search-input-row");
  const mark = element("span", "global-search-mark");
  mark.setAttribute("aria-hidden", "true");
  input = element("input", "global-search-input");
  input.type = "search";
  input.placeholder = "Search names, paths and file contents…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("input", scheduleSearch);
  inputRow.append(mark, input);

  resultsNode = element("div", "global-search-results");

  const footer = element("footer", "global-search-footer");
  footerStatus = element("span", "global-search-status");
  footerStatus.textContent = "Local index";
  const hints = element("span", "global-search-hints");
  hints.textContent = "Arrow keys to navigate · Enter to open · Esc to close";
  footer.append(footerStatus, hints);

  palette.append(inputRow, resultsNode, footer);
  overlay.append(palette);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closePalette();
  });
  document.body.append(overlay);
  input.focus();
  void runSearch("");
}

function handleKeyDown(event: KeyboardEvent) {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === "k") {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPalette();
    return;
  }
  if (!overlay) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePalette();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    event.stopImmediatePropagation();
    moveSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    event.stopImmediatePropagation();
    moveSelection(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    event.stopImmediatePropagation();
    void activateResult();
  }
}

export function installGlobalSearch() {
  window.addEventListener("keydown", handleKeyDown, true);
  void ensureIndex().catch(() => {});
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    closePalette();
  };
}

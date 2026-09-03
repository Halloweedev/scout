import "../search-v2.css";
import { invoke } from "@tauri-apps/api/core";
import { registerAction } from "./actions";
import { openEntry } from "./fs";
import { enqueueAndWait } from "./operation-queue";

const INDEX_VERSION = 2;
const SAVED_SEARCHES_KEY = "scout.saved-searches.v1";
type SearchMode = "indexed" | "deep";

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
  size?: number | null;
  modifiedMs?: number | null;
  score: number;
  matchContext: string | null;
}

interface SavedSearch {
  id: string;
  query: string;
  createdAt: number;
  mode?: SearchMode;
}

const indexStatus = () => invoke<IndexStatus>("index_status");
const searchIndex = (query: string, limit = 40) => invoke<SearchResult[]>("search_index_v2", { query, limit });
const deepSearch = (query: string, limit = 40) => invoke<SearchResult[]>("deep_search", { root: null, query, limit });
const recordIndexOpen = (path: string) => invoke<void>("record_index_open", { path });

let overlay: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let resultsNode: HTMLDivElement | null = null;
let savedNode: HTMLDivElement | null = null;
let saveButton: HTMLButtonElement | null = null;
let footerStatus: HTMLSpanElement | null = null;
let modeNode: HTMLDivElement | null = null;
let results: SearchResult[] = [];
let savedSearches: SavedSearch[] = readSavedSearches();
let selectedIndex = 0;
let searchToken = 0;
let searchTimer: number | undefined;
let indexingPromise: Promise<IndexStatus> | null = null;
let mode: SearchMode = "indexed";

function readSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSearch[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => !!item?.id && typeof item.query === "string")
      : [];
  } catch {
    return [];
  }
}

function persistSavedSearches() {
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(savedSearches));
  window.dispatchEvent(new CustomEvent("scout:saved-searches-changed", { detail: { searches: savedSearches } }));
}

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
  indexingPromise = enqueueAndWait<IndexStatus>(
    "enqueue_index_rebuild",
    { root: null },
    (job) => {
      if (job.detail) setStatus(job.detail);
    },
  ).finally(() => {
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

function updateSaveButton() {
  if (!saveButton || !input) return;
  const query = input.value.trim();
  saveButton.disabled = !query || savedSearches.some((item) =>
    item.query.toLocaleLowerCase() === query.toLocaleLowerCase() && (item.mode ?? "indexed") === mode
  );
}

function renderMode() {
  if (!modeNode) return;
  for (const button of modeNode.querySelectorAll<HTMLButtonElement>("button[data-search-mode]")) {
    button.classList.toggle("active", button.dataset.searchMode === mode);
  }
}

function setMode(next: SearchMode, run = true) {
  if (mode === next && !run) return;
  mode = next;
  renderMode();
  renderSavedSearches();
  updateSaveButton();
  if (input) {
    input.placeholder = mode === "deep"
      ? "Deep Search… content:\"exact text\" path:project"
      : "Search… type:image ext:png size:>5mb modified:7d";
  }
  if (run) void runSearch();
}

function renderSavedSearches() {
  if (!savedNode) return;
  savedNode.replaceChildren();
  const query = input?.value.trim() ?? "";
  savedNode.hidden = !!query || savedSearches.length === 0;
  if (savedNode.hidden) return;

  const label = element("div", "global-search-saved-label");
  label.textContent = "Saved searches";
  savedNode.append(label);

  for (const saved of savedSearches) {
    const row = element("div", "global-search-saved-row");
    const open = element("button", "global-search-saved-open");
    open.type = "button";
    open.textContent = `${saved.mode === "deep" ? "Deep · " : ""}${saved.query}`;
    open.addEventListener("click", () => {
      if (!input) return;
      mode = saved.mode ?? "indexed";
      input.value = saved.query;
      renderMode();
      input.focus();
      renderSavedSearches();
      updateSaveButton();
      void runSearch(saved.query);
    });
    const remove = element("button", "global-search-saved-remove");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      savedSearches = savedSearches.filter((item) => item.id !== saved.id);
      persistSavedSearches();
      renderSavedSearches();
      updateSaveButton();
    });
    row.append(open, remove);
    savedNode.append(row);
  }
}

function saveCurrentSearch() {
  const query = input?.value.trim();
  if (!query || savedSearches.some((item) =>
    item.query.toLocaleLowerCase() === query.toLocaleLowerCase() && (item.mode ?? "indexed") === mode
  )) return;
  savedSearches = [
    { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, query, createdAt: Date.now(), mode },
    ...savedSearches,
  ].slice(0, 24);
  persistSavedSearches();
  updateSaveButton();
  setStatus("Search saved locally");
}

function renderResults() {
  if (!resultsNode) return;
  resultsNode.replaceChildren();
  if (results.length === 0) {
    const empty = element("div", "global-search-empty");
    if (!input?.value.trim()) {
      empty.textContent = mode === "deep"
        ? "Type a query to scan files directly. Deep Search is intentionally not run empty."
        : "Type to search your indexed files.";
    } else {
      empty.textContent = "No matching files or contents.";
    }
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
  const trimmed = query.trim();
  try {
    if (mode === "deep") {
      if (!trimmed) {
        results = [];
        selectedIndex = 0;
        renderResults();
        setStatus("Deep Search · direct disk scan · up to 8 MB text files");
        return;
      }
      setStatus("Deep Search · scanning disk…");
      const next = await deepSearch(trimmed, 40);
      if (token !== searchToken || !overlay) return;
      results = next;
      selectedIndex = 0;
      renderResults();
      setStatus(`Deep Search · ${next.length} result${next.length === 1 ? "" : "s"} · direct disk scan`);
      return;
    }

    const status = await ensureIndex();
    if (token !== searchToken || !overlay) return;
    setStatus(`${status.count.toLocaleString()} indexed · filters + names, paths & contents`);
    const next = await searchIndex(trimmed, 40);
    if (token !== searchToken || !overlay) return;
    results = next;
    selectedIndex = 0;
    renderResults();
  } catch (error) {
    if (token !== searchToken) return;
    results = [];
    renderResults();
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function scheduleSearch() {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  renderSavedSearches();
  updateSaveButton();
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    void runSearch();
  }, mode === "deep" ? 220 : 70);
}

function appendFilter(filter: string) {
  if (!input) return;
  const before = input.value.trimEnd();
  input.value = before ? `${before} ${filter}` : filter;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  scheduleSearch();
}

function filterBar() {
  const bar = element("div", "global-search-filterbar");
  const filters = [
    ["Type", "type:image"],
    ["Ext", "ext:png"],
    ["Size", "size:>5mb"],
    ["Modified", "modified:7d"],
    ["Path", "path:\"project\""],
    ["Content", "content:\"text\""],
  ] as const;
  for (const [label, value] of filters) {
    const button = element("button", "global-search-filter-chip");
    button.type = "button";
    button.title = value;
    button.textContent = label;
    button.addEventListener("click", () => appendFilter(value));
    bar.append(button);
  }
  return bar;
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
  savedNode = null;
  saveButton = null;
  footerStatus = null;
  modeNode = null;
  results = [];
  selectedIndex = 0;
}

function openPalette(initialQuery = "", initialMode: SearchMode = "indexed") {
  mode = initialMode;
  if (overlay) {
    if (input && initialQuery) input.value = initialQuery;
    renderMode();
    input?.focus();
    scheduleSearch();
    return;
  }

  overlay = element("div", "global-search-backdrop");
  const palette = element("section", "global-search-palette search-v2-palette");
  const inputRow = element("div", "global-search-input-row");
  const mark = element("span", "global-search-mark");
  mark.setAttribute("aria-hidden", "true");
  input = element("input", "global-search-input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = initialQuery;
  input.addEventListener("input", scheduleSearch);
  saveButton = element("button", "global-search-save");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", saveCurrentSearch);
  inputRow.append(mark, input, saveButton);

  const controls = element("div", "global-search-v2-controls");
  modeNode = element("div", "global-search-mode");
  for (const [value, label] of [["indexed", "Indexed"], ["deep", "Deep"]] as const) {
    const button = element("button", "global-search-mode-button");
    button.type = "button";
    button.dataset.searchMode = value;
    button.textContent = label;
    button.addEventListener("click", () => setMode(value));
    modeNode.append(button);
  }
  controls.append(modeNode, filterBar());

  savedNode = element("div", "global-search-saved");
  resultsNode = element("div", "global-search-results");

  const footer = element("footer", "global-search-footer");
  footerStatus = element("span", "global-search-status");
  footerStatus.textContent = "Search 2.0";
  const hints = element("span", "global-search-hints");
  hints.textContent = "↑↓ navigate · Enter open · Esc close";
  footer.append(footerStatus, hints);

  palette.append(inputRow, controls, savedNode, resultsNode, footer);
  overlay.append(palette);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closePalette();
  });
  document.body.append(overlay);
  renderMode();
  setMode(initialMode, false);
  renderSavedSearches();
  updateSaveButton();
  input.focus();
  void runSearch(initialQuery);
}

function handleOpenSavedSearch(event: Event) {
  const detail = (event as CustomEvent<{ query?: string; mode?: SearchMode }>).detail;
  if (detail?.query) openPalette(detail.query, detail.mode ?? "indexed");
}

function handleOpenGlobalSearch(event: Event) {
  const detail = (event as CustomEvent<{ query?: string; mode?: SearchMode }>).detail;
  openPalette(detail?.query ?? "", detail?.mode ?? "indexed");
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
  const unregisterDeepSearch = registerAction({
    id: "navigation.deep-search",
    title: "Deep Search…",
    category: "Navigation",
    subtitle: "Scan files directly, including content beyond the local index sample",
    keywords: ["recursive", "disk", "content", "grep", "search"],
    run: () => openPalette("", "deep"),
  });
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scout:open-global-search", handleOpenGlobalSearch);
  window.addEventListener("scout:open-saved-search", handleOpenSavedSearch);
  void ensureIndex().catch(() => {});
  return () => {
    unregisterDeepSearch();
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scout:open-global-search", handleOpenGlobalSearch);
    window.removeEventListener("scout:open-saved-search", handleOpenSavedSearch);
    closePalette();
  };
}

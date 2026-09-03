import { actionContext, availableActions, onActionsChanged, runAction, type ScoutAction } from "./actions";

const RECENTS_KEY = "scout:action-recents:v1";
let overlay: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let results: HTMLDivElement | null = null;
let empty: HTMLDivElement | null = null;
let visible: ScoutAction[] = [];
let selectedIndex = 0;
let toastTimer: number | undefined;

interface RecentEntry { count: number; last: number }

function recents(): Record<string, RecentEntry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function recordRecent(id: string) {
  const current = recents();
  const previous = current[id] ?? { count: 0, last: 0 };
  current[id] = { count: previous.count + 1, last: Date.now() };
  const trimmed = Object.fromEntries(
    Object.entries(current).sort(([, a], [, b]) => b.last - a.last).slice(0, 40),
  );
  localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed));
}

function compact(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function subsequenceScore(needle: string, haystack: string) {
  let cursor = 0;
  let score = 0;
  let last = -2;
  for (const char of needle) {
    const next = haystack.indexOf(char, cursor);
    if (next < 0) return -1;
    score += next === last + 1 ? 6 : 2;
    if (next === 0 || haystack[next - 1] === " ") score += 8;
    last = next;
    cursor = next + 1;
  }
  return score;
}

function score(action: ScoutAction, query: string) {
  if (!query) return 0;
  const title = compact(action.title);
  const haystack = compact([action.title, action.subtitle, action.category, ...(action.keywords ?? [])].filter(Boolean).join(" "));
  const tokens = compact(query).split(" ").filter(Boolean);
  let total = 0;
  for (const token of tokens) {
    if (title === token) total += 180;
    else if (title.startsWith(token)) total += 130;
    else if (title.includes(token)) total += 95;
    else if (haystack.includes(token)) total += 60;
    else {
      const fuzzy = subsequenceScore(token, haystack);
      if (fuzzy < 0) return -1;
      total += fuzzy;
    }
  }
  return total;
}

function actionList(query = "") {
  const context = actionContext();
  const recent = recents();
  return availableActions(context)
    .map((action) => ({ action, score: score(action, query), recent: recent[action.id] }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => {
      if (query) return b.score - a.score || (b.recent?.last ?? 0) - (a.recent?.last ?? 0) || a.action.title.localeCompare(b.action.title);
      return (b.recent?.last ?? 0) - (a.recent?.last ?? 0) || (b.recent?.count ?? 0) - (a.recent?.count ?? 0) || a.action.category.localeCompare(b.action.category) || a.action.title.localeCompare(b.action.title);
    })
    .slice(0, 16)
    .map((item) => item.action);
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function renderResults() {
  if (!results || !input || !empty) return;
  visible = actionList(input.value);
  selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, visible.length - 1)));
  results.replaceChildren();
  empty.hidden = visible.length > 0;

  visible.forEach((action, index) => {
    const row = create("button", "command-palette-row");
    row.type = "button";
    row.dataset.actionId = action.id;
    row.classList.toggle("selected", index === selectedIndex);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");

    const copy = create("span", "command-palette-copy");
    const title = create("span", "command-palette-title");
    title.textContent = action.title;
    const detail = create("span", "command-palette-detail");
    detail.textContent = action.subtitle || action.category;
    copy.append(title, detail);

    const meta = create("span", "command-palette-meta");
    const category = create("span", "command-palette-category");
    category.textContent = action.category;
    meta.append(category);
    if (action.shortcut) {
      const shortcut = create("kbd", "command-palette-shortcut");
      shortcut.textContent = action.shortcut;
      meta.append(shortcut);
    }
    row.append(copy, meta);
    row.addEventListener("pointerenter", () => {
      selectedIndex = index;
      updateSelection();
    });
    row.addEventListener("click", () => void activate(index));
    results!.append(row);
  });
}

function updateSelection() {
  if (!results) return;
  const rows = [...results.querySelectorAll<HTMLElement>(".command-palette-row")];
  rows.forEach((row, index) => {
    const active = index === selectedIndex;
    row.classList.toggle("selected", active);
    row.setAttribute("aria-selected", active ? "true" : "false");
    if (active) row.scrollIntoView({ block: "nearest" });
  });
}

async function activate(index = selectedIndex) {
  const action = visible[index];
  if (!action) return;
  const context = actionContext();
  closeCommandPalette();
  try {
    await runAction(action.id, context);
    recordRecent(action.id);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

function moveSelection(delta: number) {
  if (!visible.length) return;
  selectedIndex = (selectedIndex + delta + visible.length) % visible.length;
  updateSelection();
}

export function closeCommandPalette() {
  overlay?.remove();
  overlay = null;
  input = null;
  results = null;
  empty = null;
  visible = [];
  selectedIndex = 0;
}

export function openCommandPalette(initialQuery = "") {
  closeCommandPalette();
  overlay = create("div", "command-palette-backdrop");
  overlay.setAttribute("role", "presentation");
  const panel = create("section", "command-palette");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Scout Command Palette");

  const search = create("div", "command-palette-search");
  input = create("input", "command-palette-input");
  input.type = "text";
  input.value = initialQuery;
  input.placeholder = "Type a command…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search Scout commands");
  const hint = create("kbd", "command-palette-hint");
  hint.textContent = "Esc";
  search.append(input, hint);

  results = create("div", "command-palette-results");
  results.setAttribute("role", "listbox");
  empty = create("div", "command-palette-empty");
  empty.textContent = "No matching commands";
  panel.append(search, results, empty);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) closeCommandPalette();
  });
  input.addEventListener("input", () => {
    selectedIndex = 0;
    renderResults();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void activate();
    }
  });
  document.body.append(overlay);
  renderResults();
  input.focus();
  input.select();
}

function showToast(message: string, error = false) {
  document.querySelector(".scout-action-toast")?.remove();
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  const toast = create("div", `scout-action-toast${error ? " error" : ""}`);
  toast.textContent = message;
  document.body.append(toast);
  toastTimer = window.setTimeout(() => toast.remove(), 2200);
}

function handleKeyDown(event: KeyboardEvent) {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (overlay) closeCommandPalette();
    else openCommandPalette();
  }
}

function handleToast(event: Event) {
  const detail = (event as CustomEvent<{ message?: string; error?: boolean }>).detail;
  if (detail?.message) showToast(detail.message, !!detail.error);
}

function handleActionError(event: Event) {
  const message = (event as CustomEvent<{ message?: string }>).detail?.message;
  if (message) showToast(message, true);
}

export function installCommandPalette() {
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scout:toast", handleToast);
  window.addEventListener("scout:action-error", handleActionError);
  const stopRegistryListener = onActionsChanged(() => {
    if (overlay) renderResults();
  });
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scout:toast", handleToast);
    window.removeEventListener("scout:action-error", handleActionError);
    stopRegistryListener();
    closeCommandPalette();
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    document.querySelector(".scout-action-toast")?.remove();
  };
}

import { invoke } from "@tauri-apps/api/core";
import { runAction, type ScoutActionContext } from "./actions";

interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
  modified: boolean;
  untracked: boolean;
  conflicted: boolean;
}

interface GitRepositoryStatus {
  root: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

let observer: MutationObserver | null = null;
let refreshTimer: number | null = null;
let generation = 0;
let disposed = false;

function normalizePath(path: string) {
  const windows = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
  let value = path.replace(/\\/g, "/");
  if (value.length > 1 && !/^[A-Za-z]:\/$/.test(value)) value = value.replace(/\/+$/, "");
  return windows ? value.toLocaleLowerCase() : value;
}

function absolutePath(root: string, relative: string) {
  if (!relative) return root;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/^[\\/]+/, "")}`;
}

function pathWithin(path: string, parent: string) {
  const child = normalizePath(path);
  const root = normalizePath(parent);
  if (child === root) return true;
  return child.startsWith(root.endsWith("/") ? root : `${root}/`);
}

function exactMarker(file: GitFileStatus) {
  if (file.conflicted) return { label: "!", state: "conflict", title: "Git conflict" };
  if (file.untracked) return { label: "?", state: "untracked", title: "Git: untracked" };
  if (file.staged && file.modified) return { label: "M", state: "mixed", title: "Git: staged and modified" };
  if (file.modified) return { label: "M", state: "modified", title: "Git: modified" };
  if (file.staged) return { label: "A", state: "staged", title: "Git: staged" };
  const code = file.status.trim().slice(0, 1) || "M";
  return { label: code, state: "changed", title: `Git: ${file.status.trim() || "changed"}` };
}

function makeBadge(label: string, state: string, title: string) {
  const badge = document.createElement("span");
  badge.className = "git-ambient-badge";
  badge.dataset.gitState = state;
  badge.textContent = label;
  badge.title = title;
  badge.setAttribute("aria-hidden", "true");
  return badge;
}

function placeBadge(row: HTMLElement, badge: HTMLElement) {
  if (row.classList.contains("grid") || row.classList.contains("gallery")) {
    row.append(badge);
    return;
  }
  const name = row.querySelector<HTMLElement>(".file-name, .column-browser-name");
  if (name) name.insertAdjacentElement("afterend", badge);
  else row.append(badge);
}

function paneActionContext(path: string): ScoutActionContext {
  return {
    panePath: path,
    selection: [],
    selectedPaths: [],
    tabCount: document.querySelectorAll(".tab").length,
    hasActiveTab: !!document.querySelector(".tab.active"),
  };
}

function repositoryBadge(path: string, report: GitRepositoryStatus) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "git-ambient-pane";

  const prefix = document.createElement("span");
  prefix.className = "git-ambient-prefix";
  prefix.textContent = "git";

  const branch = document.createElement("span");
  branch.className = "git-ambient-branch";
  branch.textContent = report.branch;
  button.append(prefix, branch);

  if (report.files.length) {
    const dirty = document.createElement("span");
    dirty.className = "git-ambient-dirty";
    dirty.textContent = String(report.files.length);
    button.append(dirty);
  }
  if (report.ahead) {
    const ahead = document.createElement("span");
    ahead.className = "git-ambient-sync";
    ahead.textContent = `↑${report.ahead}`;
    button.append(ahead);
  }
  if (report.behind) {
    const behind = document.createElement("span");
    behind.className = "git-ambient-sync";
    behind.textContent = `↓${report.behind}`;
    button.append(behind);
  }

  const changes = report.files.length ? `, ${report.files.length} changed item${report.files.length === 1 ? "" : "s"}` : ", clean working tree";
  button.setAttribute("aria-label", `Git branch ${report.branch}${changes}. Open Git Status.`);
  button.title = `${report.root}\n${report.upstream ? `Tracking ${report.upstream}` : "No upstream"}`;
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void runAction("developer.git-status", paneActionContext(path));
  });
  return button;
}

function clearPaneState(pane: HTMLElement) {
  pane.querySelectorAll(".git-ambient-badge, .git-ambient-pane").forEach((node) => node.remove());
  pane.querySelectorAll<HTMLElement>("[data-git-state]").forEach((row) => delete row.dataset.gitState);
  pane.classList.remove("git-aware-pane");
}

function annotatePane(pane: HTMLElement, path: string, report: GitRepositoryStatus | null) {
  clearPaneState(pane);
  pane.classList.toggle("git-aware-pane", !!report);
  if (!report) return;

  const chrome = pane.querySelector<HTMLElement>(".pane-chrome");
  const close = chrome?.querySelector(".pane-close-button");
  if (chrome) chrome.insertBefore(repositoryBadge(path, report), close ?? null);

  const exact = new Map<string, GitFileStatus>();
  const changedPaths: string[] = [];
  for (const file of report.files) {
    const full = absolutePath(report.root, file.path);
    exact.set(normalizePath(full), file);
    changedPaths.push(full);
  }

  const rows = [...pane.querySelectorAll<HTMLElement>("[data-entry-path]")];
  for (const row of rows) {
    const rowPath = row.dataset.entryPath;
    if (!rowPath) continue;
    const file = exact.get(normalizePath(rowPath));
    if (file) {
      const marker = exactMarker(file);
      row.dataset.gitState = marker.state;
      placeBadge(row, makeBadge(marker.label, marker.state, marker.title));
      continue;
    }

    if (row.dataset.entryKind !== "directory") continue;
    let nested = 0;
    for (const changed of changedPaths) {
      if (normalizePath(changed) !== normalizePath(rowPath) && pathWithin(changed, rowPath)) nested += 1;
    }
    if (!nested) continue;
    row.dataset.gitState = "nested";
    placeBadge(row, makeBadge("•", "nested", `${nested} Git change${nested === 1 ? "" : "s"} inside`));
  }
}

async function readStatus(path: string) {
  try {
    return await invoke<GitRepositoryStatus | null>("git_repository_status", { path });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not installed|not available on path/i.test(message)) console.debug("Scout Git awareness refresh failed", error);
    return null;
  }
}

async function refreshAmbient() {
  refreshTimer = null;
  const token = ++generation;
  const panes = [...document.querySelectorAll<HTMLElement>(".explorer-pane[data-pane-path]")];
  const paths = [...new Set(panes.map((pane) => pane.dataset.panePath).filter((path): path is string => !!path))];
  if (!paths.length) return;

  const reports = new Map<string, GitRepositoryStatus | null>();
  await Promise.all(paths.map(async (path) => reports.set(path, await readStatus(path))));
  if (disposed || token !== generation) return;

  for (const pane of panes) {
    const path = pane.dataset.panePath;
    if (!path) continue;
    annotatePane(pane, path, reports.get(path) ?? null);
  }
}

function scheduleRefresh(delay = 180) {
  if (disposed) return;
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refreshAmbient(), delay);
}

function nodeAffectsExplorer(node: Node) {
  if (!(node instanceof Element)) return false;
  if (node.matches(".explorer-pane, [data-entry-path]")) return true;
  return !!node.querySelector(".explorer-pane, [data-entry-path]");
}

function mutationAffectsExplorer(mutation: MutationRecord) {
  if (mutation.type === "attributes") return true;
  return [...mutation.addedNodes, ...mutation.removedNodes].some(nodeAffectsExplorer);
}

function handleActionRan(event: Event) {
  const id = (event as CustomEvent<{ id?: string }>).detail?.id ?? "";
  if (id.startsWith("developer.git-")) scheduleRefresh(0);
}

function handleToast(event: Event) {
  const message = (event as CustomEvent<{ message?: string }>).detail?.message ?? "";
  if (/\b(staged|unstaged|discarded)\b/i.test(message)) scheduleRefresh(0);
}

export function installGitAmbient() {
  disposed = false;
  observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationAffectsExplorer)) scheduleRefresh();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-pane-path", "data-entry-path", "data-entry-modified"],
  });

  const handleFocus = () => scheduleRefresh(0);
  const handleRefresh = () => scheduleRefresh(0);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("scout:action-ran", handleActionRan);
  window.addEventListener("scout:toast", handleToast);
  window.addEventListener("scout:git-refresh", handleRefresh);
  scheduleRefresh(0);

  return () => {
    disposed = true;
    generation += 1;
    observer?.disconnect();
    observer = null;
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("scout:action-ran", handleActionRan);
    window.removeEventListener("scout:toast", handleToast);
    window.removeEventListener("scout:git-refresh", handleRefresh);
    document.querySelectorAll<HTMLElement>(".explorer-pane").forEach(clearPaneState);
  };
}

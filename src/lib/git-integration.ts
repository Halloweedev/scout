import { invoke } from "@tauri-apps/api/core";
import { registerActions, type ScoutActionContext } from "./actions";

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

let overlay: HTMLDivElement | null = null;
let diffOverlay: HTMLDivElement | null = null;
let activePath = "";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function toast(message: string) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message } }));
}

function sourcePath(context: ScoutActionContext) {
  return context.selection[0]?.path ?? context.panePath;
}

function closeDiff() {
  diffOverlay?.remove();
  diffOverlay = null;
}

function close() {
  closeDiff();
  overlay?.remove();
  overlay = null;
  activePath = "";
}

function parentPath(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return path;
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.slice(0, index);
}

function absolutePath(root: string, relative: string) {
  if (!relative) return root;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/^[\\/]+/, "")}`;
}

function reveal(path: string) {
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: parentPath(path) } }));
  close();
}

function statusLabel(file: GitFileStatus) {
  if (file.conflicted) return "CONFLICT";
  if (file.untracked) return "NEW";
  const code = file.status.trim();
  return code || "MOD";
}

function metric(label: string, value: number) {
  const node = element("div", "git-metric");
  const count = element("strong", "git-metric-value");
  count.textContent = value.toLocaleString();
  const copy = element("span", "git-metric-label");
  copy.textContent = label;
  node.append(count, copy);
  return node;
}

async function openDiff(path: string, staged: boolean) {
  closeDiff();
  diffOverlay = element("div", "git-diff-backdrop");
  const panel = element("section", "git-diff-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", staged ? "Staged Git diff" : "Git diff");
  const header = element("header", "git-diff-header");
  const heading = element("div", "git-diff-heading");
  const title = element("h2", "git-diff-title");
  title.textContent = staged ? "Staged Diff" : "Working Tree Diff";
  const subtitle = element("div", "git-diff-subtitle");
  subtitle.textContent = path;
  subtitle.title = path;
  heading.append(title, subtitle);
  const closeButton = element("button", "git-button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", closeDiff);
  header.append(heading, closeButton);
  const body = element("div", "git-diff-body");
  const loading = element("div", "git-empty");
  loading.textContent = "Loading diff…";
  body.append(loading);
  panel.append(header, body);
  diffOverlay.append(panel);
  diffOverlay.addEventListener("pointerdown", (event) => {
    if (event.target === diffOverlay) closeDiff();
  });
  document.body.append(diffOverlay);

  try {
    const diff = await invoke<string>("git_diff", { path, staged });
    if (!diffOverlay) return;
    body.replaceChildren();
    if (!diff.trim()) {
      const empty = element("div", "git-empty");
      empty.textContent = staged ? "No staged changes for this item." : "No working-tree changes for this item.";
      body.append(empty);
      return;
    }
    const pre = element("pre", "git-diff-content");
    pre.textContent = diff;
    body.append(pre);
  } catch (error) {
    if (!diffOverlay) return;
    body.replaceChildren();
    const failure = element("div", "git-failure");
    failure.textContent = error instanceof Error ? error.message : String(error);
    body.append(failure);
  }
}

async function mutate(command: "git_stage" | "git_unstage" | "git_discard", paths: string[], refresh: () => Promise<void>) {
  await invoke(command, { paths });
  const label = command === "git_stage" ? "Staged" : command === "git_unstage" ? "Unstaged" : "Discarded working-tree changes for";
  toast(`${label} ${paths.length === 1 ? "item" : `${paths.length} items`}`);
  await refresh();
}

function fileRow(root: string, file: GitFileStatus, refresh: () => Promise<void>) {
  const row = element("article", `git-file-row${file.conflicted ? " conflicted" : ""}`);
  const status = element("span", "git-file-status");
  status.textContent = statusLabel(file);
  status.title = file.status;
  const copy = element("div", "git-file-copy");
  const name = element("strong", "git-file-name");
  name.textContent = file.path.split("/").at(-1) ?? file.path;
  const path = element("span", "git-file-path");
  path.textContent = file.path;
  path.title = file.path;
  copy.append(name, path);
  const actions = element("div", "git-file-actions");
  const fullPath = absolutePath(root, file.path);

  const revealButton = element("button", "git-row-button");
  revealButton.type = "button";
  revealButton.textContent = "Reveal";
  revealButton.addEventListener("click", () => reveal(fullPath));
  actions.append(revealButton);

  if (file.modified && !file.untracked) {
    const diff = element("button", "git-row-button");
    diff.type = "button";
    diff.textContent = "Diff";
    diff.addEventListener("click", () => void openDiff(fullPath, false));
    actions.append(diff);
  }
  if (file.staged) {
    const stagedDiff = element("button", "git-row-button");
    stagedDiff.type = "button";
    stagedDiff.textContent = "Staged Diff";
    stagedDiff.addEventListener("click", () => void openDiff(fullPath, true));
    const unstage = element("button", "git-row-button");
    unstage.type = "button";
    unstage.textContent = "Unstage";
    unstage.addEventListener("click", () => void mutate("git_unstage", [fullPath], refresh));
    actions.append(stagedDiff, unstage);
  }
  if (file.modified || file.untracked) {
    const stage = element("button", "git-row-button");
    stage.type = "button";
    stage.textContent = "Stage";
    stage.addEventListener("click", () => void mutate("git_stage", [fullPath], refresh));
    actions.append(stage);
  }
  if (file.modified && !file.untracked) {
    const discard = element("button", "git-row-button danger");
    discard.type = "button";
    discard.textContent = "Discard";
    discard.addEventListener("click", () => {
      if (!window.confirm(`Discard uncommitted working-tree changes in ${file.path}?`)) return;
      void mutate("git_discard", [fullPath], refresh);
    });
    actions.append(discard);
  }

  row.append(status, copy, actions);
  return row;
}

function renderRepository(body: HTMLElement, report: GitRepositoryStatus, refresh: () => Promise<void>) {
  body.replaceChildren();
  const repository = element("section", "git-repository-summary");
  const top = element("div", "git-repository-top");
  const branch = element("strong", "git-branch");
  branch.textContent = report.branch;
  const tracking = element("span", "git-upstream");
  tracking.textContent = report.upstream ?? "No upstream";
  top.append(branch, tracking);
  const metrics = element("div", "git-metrics");
  const staged = report.files.filter((file) => file.staged).length;
  const changed = report.files.filter((file) => file.modified).length;
  const untracked = report.files.filter((file) => file.untracked).length;
  metrics.append(metric("Staged", staged), metric("Changed", changed), metric("Untracked", untracked));
  if (report.ahead || report.behind) {
    metrics.append(metric("Ahead", report.ahead), metric("Behind", report.behind));
  }
  repository.append(top, metrics);
  body.append(repository);

  if (!report.files.length) {
    const empty = element("div", "git-empty");
    empty.textContent = "Working tree clean.";
    body.append(empty);
    return;
  }

  const bulk = element("div", "git-bulk-actions");
  const stageable = report.files.filter((file) => file.modified || file.untracked).map((file) => absolutePath(report.root, file.path));
  const stagedPaths = report.files.filter((file) => file.staged).map((file) => absolutePath(report.root, file.path));
  if (stageable.length) {
    const stageAll = element("button", "git-button");
    stageAll.type = "button";
    stageAll.textContent = "Stage Changes";
    stageAll.addEventListener("click", () => void mutate("git_stage", stageable, refresh));
    bulk.append(stageAll);
  }
  if (stagedPaths.length) {
    const unstageAll = element("button", "git-button");
    unstageAll.type = "button";
    unstageAll.textContent = "Unstage All";
    unstageAll.addEventListener("click", () => void mutate("git_unstage", stagedPaths, refresh));
    bulk.append(unstageAll);
  }
  if (bulk.childElementCount) body.append(bulk);

  const list = element("div", "git-file-list");
  for (const file of report.files) list.append(fileRow(report.root, file, refresh));
  body.append(list);
}

async function refreshRepository(body: HTMLElement, path: string) {
  body.replaceChildren();
  const loading = element("div", "git-empty");
  loading.textContent = "Reading repository status…";
  body.append(loading);
  try {
    const report = await invoke<GitRepositoryStatus | null>("git_repository_status", { path });
    if (!overlay || activePath !== path) return;
    if (!report) {
      body.replaceChildren();
      const empty = element("div", "git-empty");
      empty.textContent = "This location is not inside a Git repository.";
      body.append(empty);
      return;
    }
    renderRepository(body, report, () => refreshRepository(body, path));
  } catch (error) {
    if (!overlay || activePath !== path) return;
    body.replaceChildren();
    const failure = element("div", "git-failure");
    failure.textContent = error instanceof Error ? error.message : String(error);
    body.append(failure);
  }
}

function openGitStatus(context: ScoutActionContext) {
  const path = sourcePath(context);
  if (!path) throw new Error("No folder or file is available for Git status");
  close();
  activePath = path;
  overlay = element("div", "git-backdrop");
  const panel = element("section", "git-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Git status");
  const header = element("header", "git-header");
  const heading = element("div", "git-heading");
  const title = element("h2", "git-title");
  title.textContent = "Git Status";
  const subtitle = element("div", "git-subtitle");
  subtitle.textContent = path;
  subtitle.title = path;
  heading.append(title, subtitle);
  const headerActions = element("div", "git-header-actions");
  const refresh = element("button", "git-button");
  refresh.type = "button";
  refresh.textContent = "Refresh";
  const closeButton = element("button", "git-button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  headerActions.append(refresh, closeButton);
  header.append(heading, headerActions);
  const body = element("div", "git-body");
  panel.append(header, body);
  overlay.append(panel);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  refresh.addEventListener("click", () => void refreshRepository(body, path));
  closeButton.addEventListener("click", close);
  document.body.append(overlay);
  void refreshRepository(body, path);
}

export function installGitIntegration() {
  const cleanup = registerActions([
    {
      id: "developer.git-status",
      title: "Git Status…",
      category: "Developer",
      subtitle: "Inspect, stage, unstage, diff, and discard repository changes",
      keywords: ["git", "repository", "branch", "status", "stage", "diff", "developer"],
      available: (context) => !!sourcePath(context),
      run: openGitStatus,
    },
    {
      id: "developer.git-diff",
      title: "Show Git Diff",
      category: "Developer",
      keywords: ["git", "diff", "changes", "developer"],
      available: (context) => context.selection.length === 1 && context.selection[0].kind !== "directory",
      run: (context) => openDiff(context.selection[0].path, false),
    },
    {
      id: "developer.git-stage",
      title: "Stage with Git",
      category: "Developer",
      keywords: ["git", "add", "stage", "index"],
      available: (context) => context.selectedPaths.length > 0,
      run: async (context) => {
        await invoke("git_stage", { paths: context.selectedPaths });
        toast(context.selectedPaths.length === 1 ? "Staged item" : `Staged ${context.selectedPaths.length} items`);
      },
    },
    {
      id: "developer.git-unstage",
      title: "Unstage with Git",
      category: "Developer",
      keywords: ["git", "restore", "unstage", "index"],
      available: (context) => context.selectedPaths.length > 0,
      run: async (context) => {
        await invoke("git_unstage", { paths: context.selectedPaths });
        toast(context.selectedPaths.length === 1 ? "Unstaged item" : `Unstaged ${context.selectedPaths.length} items`);
      },
    },
    {
      id: "developer.git-discard",
      title: "Discard Git Working Changes",
      category: "Developer",
      subtitle: "Restore selected tracked files from the Git index",
      keywords: ["git", "discard", "restore", "revert", "working tree"],
      danger: true,
      available: (context) => context.selectedPaths.length > 0,
      run: async (context) => {
        if (!window.confirm(`Discard uncommitted working-tree changes for ${context.selectedPaths.length === 1 ? "the selected item" : `${context.selectedPaths.length} selected items`}?`)) return;
        await invoke("git_discard", { paths: context.selectedPaths });
        toast("Discarded working-tree changes");
      },
    },
  ]);

  return () => {
    cleanup();
    close();
  };
}

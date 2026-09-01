import { invoke } from "@tauri-apps/api/core";

export interface OperationJob<T = unknown> {
  id: number;
  kind: string;
  label: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number | null;
  detail: string | null;
  error: string | null;
  result: T | null;
  cancellable: boolean;
  createdMs: number;
  startedMs: number | null;
  finishedMs: number | null;
}

let observer: MutationObserver | null = null;
let pollTimer: number | undefined;
let panel: HTMLDivElement | null = null;
let cachedJobs: OperationJob[] = [];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function operationJobs() {
  return invoke<OperationJob[]>("operation_queue");
}

export async function cancelOperation(id: number) {
  return invoke<boolean>("cancel_operation", { id });
}

export async function enqueueAndWait<T>(
  command: string,
  args: Record<string, unknown>,
  onUpdate?: (job: OperationJob<T>) => void,
): Promise<T> {
  const id = await invoke<number>(command, args);
  for (;;) {
    const jobs = await operationJobs();
    const job = jobs.find((candidate) => candidate.id === id) as OperationJob<T> | undefined;
    if (!job) throw new Error("Queued operation disappeared from history");
    onUpdate?.(job);
    if (job.status === "completed") {
      if (job.result == null) throw new Error("Operation completed without a result");
      return job.result;
    }
    if (job.status === "failed") throw new Error(job.error ?? "Operation failed");
    if (job.status === "cancelled") throw new Error("Operation cancelled");
    await sleep(280);
  }
}

function activeCount() {
  return cachedJobs.filter((job) => job.status === "queued" || job.status === "running").length;
}

function closePanel() {
  panel?.remove();
  panel = null;
}

function statusLabel(job: OperationJob) {
  if (job.status === "running" && job.progress != null) return `${Math.round(job.progress * 100)}%`;
  return job.status[0].toUpperCase() + job.status.slice(1);
}

function renderPanel() {
  if (!panel) return;
  const body = panel.querySelector<HTMLElement>(".operation-queue-body");
  if (!body) return;
  body.replaceChildren();

  if (!cachedJobs.length) {
    const empty = element("div", "operation-queue-empty");
    empty.textContent = "No operations yet.";
    body.append(empty);
    return;
  }

  for (const job of cachedJobs) {
    const row = element("article", `operation-job ${job.status}`);
    const top = element("div", "operation-job-top");
    const label = element("div", "operation-job-label");
    label.textContent = job.label;
    const status = element("span", "operation-job-status");
    status.textContent = statusLabel(job);
    top.append(label, status);

    const detail = element("div", "operation-job-detail");
    detail.textContent = job.error ?? job.detail ?? job.kind;
    row.append(top, detail);

    if ((job.status === "queued" || job.status === "running") && job.progress != null) {
      const track = element("div", "operation-progress-track");
      const fill = element("div", "operation-progress-fill");
      fill.style.width = `${Math.max(0, Math.min(100, job.progress * 100))}%`;
      track.append(fill);
      row.append(track);
    }

    if ((job.status === "queued" || job.status === "running") && job.cancellable) {
      const cancel = element("button", "operation-cancel");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => void cancelOperation(job.id));
      row.append(cancel);
    }
    body.append(row);
  }
}

function openPanel() {
  closePanel();
  panel = element("div", "operation-queue-backdrop");
  const sheet = element("section", "operation-queue-sheet");
  const header = element("header", "operation-queue-header");
  const heading = element("div");
  const title = element("div", "operation-queue-title");
  title.textContent = "Operations";
  const subtitle = element("div", "operation-queue-subtitle");
  subtitle.textContent = activeCount() ? `${activeCount()} active` : "Recent activity";
  heading.append(title, subtitle);
  const actions = element("div", "operation-queue-header-actions");
  const clear = element("button", "operation-queue-text-button");
  clear.type = "button";
  clear.textContent = "Clear finished";
  clear.addEventListener("click", async () => {
    await invoke<void>("clear_finished_operations");
    cachedJobs = await operationJobs();
    renderPanel();
  });
  const close = element("button", "operation-queue-text-button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", closePanel);
  actions.append(clear, close);
  header.append(heading, actions);
  const body = element("div", "operation-queue-body");
  sheet.append(header, body);
  panel.append(sheet);
  panel.addEventListener("pointerdown", (event) => {
    if (event.target === panel) closePanel();
  });
  document.body.append(panel);
  renderPanel();
}

function ensureSidebarButton() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebar || sidebar.querySelector(".operation-queue-sidebar")) return;
  const section = element("div", "operation-queue-sidebar");
  const label = element("div", "sidebar-section-label");
  label.textContent = "Activity";
  const nav = element("nav", "sidebar-nav");
  const button = element("button", "sidebar-item operation-queue-sidebar-button");
  button.type = "button";
  const name = element("span");
  name.textContent = "Operations";
  const count = element("span", "operation-queue-count");
  count.textContent = String(activeCount());
  button.append(name, count);
  button.addEventListener("click", openPanel);
  nav.append(button);
  section.append(label, nav);
  sidebar.append(section);
}

function updateSidebar() {
  ensureSidebarButton();
  const count = document.querySelector<HTMLElement>(".operation-queue-count");
  if (count) {
    const active = activeCount();
    count.textContent = String(active);
    count.hidden = active === 0;
  }
}

async function refresh() {
  try {
    cachedJobs = await operationJobs();
    updateSidebar();
    renderPanel();
  } catch {
    // Tauri can briefly be unavailable during hot reload.
  }
}

export function installOperationQueue() {
  observer = new MutationObserver(ensureSidebarButton);
  observer.observe(document.body, { childList: true, subtree: true });
  ensureSidebarButton();
  void refresh();
  pollTimer = window.setInterval(() => void refresh(), 750);
  return () => {
    observer?.disconnect();
    observer = null;
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    pollTimer = undefined;
    closePanel();
  };
}

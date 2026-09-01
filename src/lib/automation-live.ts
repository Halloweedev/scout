import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { enqueueAndWait } from "./operation-queue";

interface AutomationTriggerEvent {
  ruleId: number;
  paths: string[];
}

interface AutomationWatchError {
  ruleId: number;
  message: string;
}

interface AutomationWatchSummary {
  active: number;
  skipped: number;
}

interface AutomationRunResult {
  ruleId: number;
  matched: number;
  affected: number;
}

const DEBOUNCE_MS = 450;
const COOLDOWN_MS = 1500;
const pendingPaths = new Map<number, Set<string>>();
const debounceTimers = new Map<number, number>();
const runningRules = new Set<number>();
const cooldownUntil = new Map<number, number>();

async function syncWatches() {
  return invoke<AutomationWatchSummary>("sync_automation_watches");
}

function clearDebounce(ruleId: number) {
  const timer = debounceTimers.get(ruleId);
  if (timer !== undefined) window.clearTimeout(timer);
  debounceTimers.delete(ruleId);
}

async function executePending(ruleId: number) {
  clearDebounce(ruleId);
  if (runningRules.has(ruleId) || Date.now() < (cooldownUntil.get(ruleId) ?? 0)) {
    pendingPaths.delete(ruleId);
    return;
  }

  const paths = [...(pendingPaths.get(ruleId) ?? [])];
  pendingPaths.delete(ruleId);
  if (!paths.length) return;

  runningRules.add(ruleId);
  try {
    await enqueueAndWait<AutomationRunResult>("enqueue_automation_trigger", { id: ruleId, paths });
  } catch (error) {
    // Disabled/deleted rules and transient filesystem races are safe no-ops here.
    console.warn("Scout automation trigger failed", error);
  } finally {
    runningRules.delete(ruleId);
    cooldownUntil.set(ruleId, Date.now() + COOLDOWN_MS);
  }
}

function queueTrigger(event: AutomationTriggerEvent) {
  const ruleId = event.ruleId;
  if (!Number.isFinite(ruleId) || !event.paths?.length) return;
  if (runningRules.has(ruleId) || Date.now() < (cooldownUntil.get(ruleId) ?? 0)) return;

  let paths = pendingPaths.get(ruleId);
  if (!paths) {
    paths = new Set<string>();
    pendingPaths.set(ruleId, paths);
  }
  for (const path of event.paths) {
    if (path) paths.add(path);
  }

  clearDebounce(ruleId);
  debounceTimers.set(ruleId, window.setTimeout(() => void executePending(ruleId), DEBOUNCE_MS));
}

function installListener<T>(eventName: string, handler: (payload: T) => void) {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void listen<T>(eventName, (event) => handler(event.payload)).then((cleanup) => {
    if (disposed) cleanup();
    else unlisten = cleanup;
  });
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}

export function installAutomationLive() {
  const removeTriggerListener = installListener<AutomationTriggerEvent>("scout-automation-trigger", queueTrigger);
  const removeErrorListener = installListener<AutomationWatchError>("scout-automation-watch-error", (error) => {
    console.warn(`Scout automation watcher ${error.ruleId}: ${error.message}`);
  });
  void syncWatches().catch((error) => console.warn("Scout could not start automation watchers", error));

  return () => {
    removeTriggerListener();
    removeErrorListener();
    for (const timer of debounceTimers.values()) window.clearTimeout(timer);
    debounceTimers.clear();
    pendingPaths.clear();
    runningRules.clear();
    cooldownUntil.clear();
  };
}

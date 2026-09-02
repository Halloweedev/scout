import { getActiveListing } from "./fs";
import { thumbnailEntry } from "./preview";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico"]);
const MAX_CACHE_ENTRIES = 320;
const MAX_CONCURRENT_LOADS = 4;

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();
const loadWaiters: Array<() => void> = [];
let activeLoads = 0;
let intersectionObserver: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let reconcileQueued = false;

function thumbnailKey(path: string, modifiedMs: number | null) {
  return `${path}:${modifiedMs ?? 0}`;
}

function cachedThumbnail(key: string) {
  const value = cache.get(key);
  if (!value) return undefined;
  // Refresh insertion order so the bounded Map behaves as a tiny LRU.
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheThumbnail(key: string, value: string) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

async function acquireLoadSlot() {
  if (activeLoads < MAX_CONCURRENT_LOADS) {
    activeLoads += 1;
    return;
  }
  await new Promise<void>((resolve) => loadWaiters.push(resolve));
  activeLoads += 1;
}

function releaseLoadSlot() {
  activeLoads = Math.max(0, activeLoads - 1);
  loadWaiters.shift()?.();
}

function requestThumbnail(path: string, key: string) {
  const cached = cachedThumbnail(key);
  if (cached) return Promise.resolve<string | null>(cached);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    await acquireLoadSlot();
    try {
      const dataUrl = await thumbnailEntry(path);
      if (dataUrl) cacheThumbnail(key, dataUrl);
      return dataUrl;
    } finally {
      releaseLoadSlot();
    }
  })().finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });

  inFlight.set(key, request);
  return request;
}

function rowEntry(row: HTMLElement) {
  const path = row.dataset.entryPath;
  const name = row.dataset.entryName;
  const kind = row.dataset.entryKind;
  const extension = row.dataset.entryExtension || null;
  const modifiedRaw = row.dataset.entryModified;
  if (path && name && kind) {
    return {
      path,
      name,
      kind,
      extension,
      modifiedMs: modifiedRaw ? Number(modifiedRaw) : null,
    };
  }

  const listing = getActiveListing();
  const index = Number(row.dataset.entryIndex);
  if (!listing || !Number.isInteger(index)) return null;
  return listing.entries[index] ?? null;
}

async function loadThumbnail(icon: HTMLElement) {
  const path = icon.dataset.thumbnailPath;
  const key = icon.dataset.thumbnailKey;
  if (!path || !key || icon.dataset.thumbnailState === "loading") return;
  icon.dataset.thumbnailState = "loading";

  try {
    const dataUrl = await requestThumbnail(path, key);
    if (!dataUrl || icon.dataset.thumbnailKey !== key || !icon.isConnected) return;

    const image = document.createElement("img");
    image.className = "file-thumbnail";
    image.src = dataUrl;
    image.alt = "";
    image.draggable = false;
    icon.replaceChildren(image);
    icon.dataset.thumbnailState = "loaded";
  } catch {
    if (icon.dataset.thumbnailKey === key) icon.dataset.thumbnailState = "failed";
  }
}

function bindRow(row: HTMLElement) {
  const entry = rowEntry(row);
  const icon = row.querySelector<HTMLElement>(".file-icon");
  const extension = entry?.extension?.toLowerCase() ?? null;
  if (!entry || !icon || entry.kind !== "file" || !extension || !IMAGE_EXTENSIONS.has(extension)) return;

  const key = thumbnailKey(entry.path, entry.modifiedMs);
  if (icon.dataset.thumbnailKey === key) return;

  icon.dataset.thumbnailKey = key;
  icon.dataset.thumbnailPath = entry.path;
  icon.dataset.thumbnailState = "waiting";
  icon.classList.add("has-thumbnail");
  intersectionObserver?.observe(icon);
}

function reconcile() {
  reconcileQueued = false;
  for (const row of document.querySelectorAll<HTMLElement>(".file-row")) bindRow(row);
}

function scheduleReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  requestAnimationFrame(reconcile);
}

export function installImageThumbnails() {
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const icon = entry.target as HTMLElement;
        intersectionObserver?.unobserve(icon);
        void loadThumbnail(icon);
      }
    },
    { root: null, rootMargin: "160px" },
  );

  mutationObserver = new MutationObserver(scheduleReconcile);
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-entry-index", "class"],
  });
  scheduleReconcile();

  return () => {
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    mutationObserver = null;
    intersectionObserver = null;
    cache.clear();
    inFlight.clear();
    loadWaiters.splice(0);
    activeLoads = 0;
  };
}

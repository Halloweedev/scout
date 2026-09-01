import { getActiveListing } from "./fs";
import { thumbnailEntry } from "./preview";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico"]);
const cache = new Map<string, string>();
let intersectionObserver: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let reconcileQueued = false;

function thumbnailKey(path: string, modifiedMs: number | null) {
  return `${path}:${modifiedMs ?? 0}`;
}

function rowEntry(row: HTMLElement) {
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
    let dataUrl = cache.get(key);
    if (!dataUrl) {
      dataUrl = (await thumbnailEntry(path)) ?? undefined;
      if (dataUrl) cache.set(key, dataUrl);
    }
    if (!dataUrl || icon.dataset.thumbnailKey !== key) return;

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
  if (!entry || !icon || entry.kind !== "file" || !entry.extension || !IMAGE_EXTENSIONS.has(entry.extension)) return;

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
  queueMicrotask(reconcile);
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
    { root: document.querySelector(".file-area"), rootMargin: "160px" },
  );

  mutationObserver = new MutationObserver(scheduleReconcile);
  mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-entry-index"] });
  scheduleReconcile();

  return () => {
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    mutationObserver = null;
    intersectionObserver = null;
    cache.clear();
  };
}

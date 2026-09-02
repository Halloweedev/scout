import { invoke } from "@tauri-apps/api/core";
import type { DirectoryListing, FsEntry, SpecialDirectories } from "../types";

let activeDirectory: string | null = null;
let activeListing: DirectoryListing | null = null;

interface DirectoryCacheEntry {
  listing: DirectoryListing;
  ts: number;
  complete: boolean;
}

const dirCache = new Map<string, DirectoryCacheEntry>();
const fastInFlight = new Map<string, Promise<DirectoryListing>>();
const fullInFlight = new Map<string, Promise<DirectoryListing>>();
const CACHE_TTL = 10000;
const MAX_CACHE_ENTRIES = 80;

function cacheKey(path: string, showHidden: boolean) {
  return `${path}::${showHidden}`;
}

function trimCache() {
  while (dirCache.size > MAX_CACHE_ENTRIES) {
    const first = dirCache.keys().next().value as string | undefined;
    if (!first) break;
    dirCache.delete(first);
  }
}

function freshCache(key: string) {
  const cached = dirCache.get(key);
  if (!cached || Date.now() - cached.ts >= CACHE_TTL) return null;
  return cached;
}

export async function listDirectory(path: string, showHidden: boolean) {
  const key = cacheKey(path, showHidden);
  const cached = freshCache(key);
  if (cached) return cached.listing;

  const existing = fastInFlight.get(key);
  if (existing) return existing;

  const request = invoke<DirectoryListing>("list_directory_fast", { path, showHidden })
    .then((listing) => {
      const current = dirCache.get(key);
      // Never replace newer, fully-hydrated metadata with the fast skeleton.
      if (!current?.complete) dirCache.set(key, { listing, ts: Date.now(), complete: false });
      trimCache();
      return current?.complete ? current.listing : listing;
    })
    .finally(() => fastInFlight.delete(key));

  fastInFlight.set(key, request);
  return request;
}

export async function hydrateDirectory(path: string, showHidden: boolean) {
  const key = cacheKey(path, showHidden);
  const cached = freshCache(key);
  if (cached?.complete) return cached.listing;

  const existing = fullInFlight.get(key);
  if (existing) return existing;

  const request = invoke<DirectoryListing>("list_directory_full", { path, showHidden })
    .then((listing) => {
      dirCache.set(key, { listing, ts: Date.now(), complete: true });
      trimCache();
      return listing;
    })
    .finally(() => fullInFlight.delete(key));

  fullInFlight.set(key, request);
  return request;
}

export function clearDirCache(path?: string) {
  if (path) {
    for (const key of [...dirCache.keys()]) {
      if (key.startsWith(`${path}::`)) dirCache.delete(key);
    }
    // Existing requests cannot be cancelled at the OS level, but their result will only
    // populate cache for their exact key and App-level navigation tokens prevent stale UI.
    return;
  }
  dirCache.clear();
}

export async function watchDirectory(path: string) {
  await invoke<void>("watch_directory", { path });
  activeDirectory = path;
}

export function setActiveListing(listing: DirectoryListing | null) {
  activeListing = listing;
  activeDirectory = listing?.path ?? null;
}

export const getActiveDirectory = () => activeDirectory;
export const getActiveListing = () => activeListing;

export const getSpecialDirectories = () =>
  invoke<SpecialDirectories>("special_directories");

export const renameEntry = (path: string, newName: string) =>
  invoke<FsEntry>("rename_entry", { path, newName });

export const duplicateEntries = (paths: string[]) =>
  invoke<FsEntry[]>("duplicate_entries", { paths });

export const copyEntries = (paths: string[], destination: string) =>
  invoke<FsEntry[]>("copy_entries", { paths, destination });

export const moveEntries = (paths: string[], destination: string) =>
  invoke<FsEntry[]>("move_entries", { paths, destination });

export const trashEntries = (paths: string[]) =>
  invoke<void>("trash_entries", { paths });

export const createFolder = (directory: string) =>
  invoke<FsEntry>("create_folder", { directory });

export const openEntry = (path: string) =>
  invoke<void>("open_entry", { path });

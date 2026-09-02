import { invoke } from "@tauri-apps/api/core";
import type { DirectoryListing, FsEntry, SpecialDirectories } from "../types";

let activeDirectory: string | null = null;
let activeListing: DirectoryListing | null = null;

const dirCache = new Map<string, { listing: DirectoryListing; ts: number }>();
const CACHE_TTL = 10000;

export async function listDirectory(path: string, showHidden: boolean) {
  const key = `${path}::${showHidden}`;
  const cached = dirCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.listing;
  const listing = await invoke<DirectoryListing>("list_directory", { path, showHidden });
  dirCache.set(key, { listing, ts: Date.now() });
  // keep cache small
  if (dirCache.size > 60) {
    const first = dirCache.keys().next().value;
    if (first) dirCache.delete(first);
  }
  return listing;
}

export function clearDirCache(path?: string) {
  if (path) {
    for (const k of [...dirCache.keys()]) if (k.startsWith(path + "::")) dirCache.delete(k);
  } else dirCache.clear();
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

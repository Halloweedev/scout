import { invoke } from "@tauri-apps/api/core";
import type { DirectoryListing, FsEntry, SpecialDirectories } from "../types";

let activeDirectory: string | null = null;

export const listDirectory = (path: string, showHidden: boolean) =>
  invoke<DirectoryListing>("list_directory", { path, showHidden });

export async function watchDirectory(path: string) {
  await invoke<void>("watch_directory", { path });
  activeDirectory = path;
}

export const getActiveDirectory = () => activeDirectory;

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

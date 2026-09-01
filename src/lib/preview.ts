import { invoke } from "@tauri-apps/api/core";
import { previewZipArchive } from "./archive";
import type { PreviewData } from "../types";

export async function previewEntry(path: string): Promise<PreviewData> {
  if (/\.zip$/i.test(path)) {
    const archive = await previewZipArchive(path);
    return {
      kind: "directory",
      name: archive.name,
      path: archive.path,
      extension: "zip",
      size: null,
      modifiedMs: null,
      text: null,
      truncated: archive.truncated,
      dataUrl: null,
      width: null,
      height: null,
      metadata: [{ label: "Entries", value: String(archive.totalEntries) }],
      children: archive.children,
    };
  }
  return invoke<PreviewData>("preview_entry", { path });
}

export const thumbnailEntry = (path: string) => invoke<string | null>("thumbnail_entry", { path });

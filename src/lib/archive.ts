import { invoke } from "@tauri-apps/api/core";
import type { PreviewChild } from "../types";

export interface ArchivePreview {
  name: string;
  path: string;
  totalEntries: number;
  truncated: boolean;
  children: PreviewChild[];
}

export const previewZipArchive = (path: string) => invoke<ArchivePreview>("preview_zip_archive", { path });

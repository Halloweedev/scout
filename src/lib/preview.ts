import { invoke } from "@tauri-apps/api/core";
import type { PreviewData } from "../types";

export const previewEntry = (path: string) => invoke<PreviewData>("preview_entry", { path });
export const thumbnailEntry = (path: string) => invoke<string | null>("thumbnail_entry", { path });

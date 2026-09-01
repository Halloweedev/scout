import { invoke } from "@tauri-apps/api/core";
import type { PreviewData } from "../types";

export const previewEntry = (path: string) => invoke<PreviewData>("preview_entry", { path });

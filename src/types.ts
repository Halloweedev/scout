export type EntryKind = "directory" | "file" | "symlink" | "other";

export interface FsEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number | null;
  modifiedMs: number | null;
  hidden: boolean;
  extension: string | null;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  displayName: string;
  entries: FsEntry[];
}

export interface SpecialDirectories {
  home: string;
  desktop: string | null;
  documents: string | null;
  downloads: string | null;
  pictures: string | null;
  music: string | null;
  movies: string | null;
  trash: string | null;
  icloud: string | null;
  drives: string[];
  network: string | null;
  applications: string | null;
}

export interface ExplorerTab {
  id: string;
  title: string;
  path: string;
  history: string[];
  historyIndex: number;
}

export interface ClipboardState {
  mode: "copy" | "move";
  paths: string[];
}

export type PreviewKind = "directory" | "image" | "text" | "markdown" | "pdf" | "audio" | "video" | "archive" | "unsupported";

export interface PreviewMetadataItem {
  label: string;
  value: string;
}

export interface PreviewChild {
  name: string;
  kind: EntryKind;
  size: number | null;
}

export interface PreviewData {
  kind: PreviewKind;
  name: string;
  path: string;
  extension: string | null;
  size: number | null;
  modifiedMs: number | null;
  text: string | null;
  truncated: boolean;
  dataUrl: string | null;
  width: number | null;
  height: number | null;
  metadata: PreviewMetadataItem[];
  children: PreviewChild[];
}

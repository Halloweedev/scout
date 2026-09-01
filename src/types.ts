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

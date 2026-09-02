import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { DirectoryListing, FsEntry, PreviewData } from "../types";
import { hydrateDirectory, listDirectory } from "../lib/fs";
import { previewEntry } from "../lib/preview";
import Icon, { type IconName } from "./Icon";

export type ColumnSort = "name" | "modified" | "size" | "type";

interface ColumnBrowserProps {
  paneId: string;
  rootPath: string;
  path: string;
  listing: DirectoryListing | null;
  showHidden: boolean;
  selected: string[];
  active: boolean;
  sortBy: ColumnSort;
  sortDir: "asc" | "desc";
  query: string;
  onFocus: () => void;
  onNavigateDirectory: (entry: FsEntry) => void | Promise<void>;
  onOpenDirectoryInNewTab: (entry: FsEntry) => void | Promise<void>;
  onSelection: (paths: string[], anchor: number | null) => void;
  onOpenFile: (entry: FsEntry) => void | Promise<void>;
  onContextMenu: (event: MouseEvent, entry: FsEntry, index: number) => void;
  renamePath: string | null;
  renameValue: string;
  onRenameInput: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}

const WIDTH_KEY = "scout.columns.width.v1";

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function comparePath(path: string) {
  const normalized = normalizePath(path);
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function joinChildPath(base: string, childName: string) {
  const separator = base.includes("\\") ? "\\" : "/";
  return base.endsWith("/") || base.endsWith("\\") ? `${base}${childName}` : `${base}${separator}${childName}`;
}

function columnPathChain(rootPath: string, currentPath: string) {
  const root = normalizePath(rootPath);
  const current = normalizePath(currentPath);
  const rootCompare = comparePath(root);
  const currentCompare = comparePath(current);

  if (rootCompare === currentCompare) return [rootPath];
  const prefix = rootCompare === "/" ? "/" : `${rootCompare}/`;
  if (!currentCompare.startsWith(prefix)) return [currentPath];

  const relative = current.slice(root.length).replace(/^\/+/, "");
  const segments = relative.split("/").filter(Boolean);
  const paths = [rootPath];
  let cursor = rootPath;
  for (const segment of segments) {
    cursor = joinChildPath(cursor, segment);
    paths.push(cursor);
  }
  return paths;
}

function formatBytes(value: number | null) {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

function formatModified(value: number | null) {
  if (value === null) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(new Date(value));
}

function iconForEntry(entry: FsEntry): IconName {
  if (entry.kind === "directory") return "folder";
  const ext = (entry.extension ?? "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "heic", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return "music";
  if (ext === "pdf") return "document";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "hard-drive";
  return "file";
}

function displayKind(preview: PreviewData) {
  if (preview.extension) return preview.extension.toUpperCase();
  if (preview.kind === "directory") return "Folder";
  return preview.kind.charAt(0).toUpperCase() + preview.kind.slice(1);
}

export default function ColumnBrowser(props: ColumnBrowserProps) {
  const [listings, setListings] = createSignal<Record<string, DirectoryListing | undefined>>({});
  const [loadingPaths, setLoadingPaths] = createSignal<Set<string>>(new Set());
  const [errors, setErrors] = createSignal<Record<string, string | undefined>>({});
  const [focusedColumn, setFocusedColumn] = createSignal(0);
  const [previewPath, setPreviewPath] = createSignal<string | null>(null);
  const [preview, setPreview] = createSignal<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const initialColumnWidth = (() => {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= 190 && value <= 420 ? value : 244;
  })();
  const [columnWidth, setColumnWidth] = createSignal(initialColumnWidth);
  let generation = 0;
  let previewGeneration = 0;
  let scroller: HTMLDivElement | undefined;

  const paths = createMemo(() => columnPathChain(props.rootPath, props.path));

  function sortedEntries(listing: DirectoryListing | undefined, columnPath?: string) {
    if (!listing) return [];
    const query = columnPath && comparePath(columnPath) === comparePath(props.path) ? props.query.trim().toLowerCase() : "";
    const entries = query ? listing.entries.filter((entry) => entry.name.toLowerCase().includes(query)) : [...listing.entries];
    const direction = props.sortDir === "asc" ? 1 : -1;
    return entries.sort((a, b) => {
      if (a.kind === "directory" && b.kind !== "directory") return -1;
      if (a.kind !== "directory" && b.kind === "directory") return 1;
      if (props.sortBy === "size") return ((a.size ?? -1) - (b.size ?? -1)) * direction;
      if (props.sortBy === "modified") return ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) * direction;
      if (props.sortBy === "type") {
        const aType = `${a.kind}:${a.extension ?? ""}:${a.name}`.toLowerCase();
        const bType = `${b.kind}:${b.extension ?? ""}:${b.name}`.toLowerCase();
        return aType.localeCompare(bType) * direction;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }

  function listingFor(path: string) {
    if (comparePath(path) === comparePath(props.path) && props.listing) return props.listing;
    return listings()[path];
  }

  function entryForPath(path: string | null) {
    if (!path) return null;
    for (const columnPath of paths()) {
      const entry = listingFor(columnPath)?.entries.find((candidate) => comparePath(candidate.path) === comparePath(path));
      if (entry) return entry;
    }
    return null;
  }

  function selectedPathForColumn(index: number) {
    const chain = paths();
    return index < chain.length - 1 ? chain[index + 1] : null;
  }

  function scrollToEnd() {
    requestAnimationFrame(() => {
      if (!scroller) return;
      scroller.scrollTo({ left: scroller.scrollWidth, behavior: "smooth" });
    });
  }

  createEffect(() => {
    const chain = paths();
    const hidden = props.showHidden;
    const currentListing = props.listing;
    const token = ++generation;

    if (currentListing) {
      setListings((current) => ({ ...current, [props.path]: currentListing }));
    }

    setFocusedColumn((current) => Math.min(current, Math.max(0, chain.length - 1)));
    for (const path of chain) {
      if (comparePath(path) === comparePath(props.path) && currentListing) continue;
      setLoadingPaths((current) => new Set(current).add(path));
      void listDirectory(path, hidden)
        .then((listing) => {
          if (token !== generation) return;
          setListings((current) => ({ ...current, [path]: listing }));
          setErrors((current) => ({ ...current, [path]: undefined }));
          void hydrateDirectory(path, hidden)
            .then((hydrated) => {
              if (token !== generation) return;
              setListings((current) => ({ ...current, [path]: hydrated }));
            })
            .catch(() => {});
        })
        .catch((error) => {
          if (token !== generation) return;
          setErrors((current) => ({ ...current, [path]: String(error) }));
        })
        .finally(() => {
          if (token !== generation) return;
          setLoadingPaths((current) => {
            const next = new Set(current);
            next.delete(path);
            return next;
          });
        });
    }
    scrollToEnd();
  });

  createEffect(() => {
    const selected = props.selected;
    if (selected.length !== 1) {
      setPreviewPath(null);
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const entry = entryForPath(selected[0]);
    if (!entry || entry.kind === "directory") {
      setPreviewPath(null);
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewPath(entry.path);
  });

  createEffect(() => {
    const path = previewPath();
    const token = ++previewGeneration;
    if (!path) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    void previewEntry(path)
      .then((data) => {
        if (token !== previewGeneration || previewPath() !== path) return;
        setPreview(data);
      })
      .catch((error) => {
        if (token !== previewGeneration || previewPath() !== path) return;
        setPreviewError(String(error));
      })
      .finally(() => {
        if (token === previewGeneration) setPreviewLoading(false);
      });
    scrollToEnd();
  });

  function selectEntry(event: MouseEvent, entry: FsEntry, entries: FsEntry[], index: number, columnIndex: number) {
    props.onFocus();
    setFocusedColumn(columnIndex);
    const modifier = event.metaKey || event.ctrlKey;
    const shift = event.shiftKey;
    const currentSelection = props.selected.filter((path) => entries.some((candidate) => comparePath(candidate.path) === comparePath(path)));

    if (modifier) {
      const next = currentSelection.includes(entry.path)
        ? currentSelection.filter((path) => path !== entry.path)
        : [...currentSelection, entry.path];
      props.onSelection(next, index);
      setPreviewPath(next.length === 1 && entry.kind !== "directory" ? entry.path : null);
      return;
    }

    if (shift && currentSelection.length) {
      const first = entries.findIndex((candidate) => comparePath(candidate.path) === comparePath(currentSelection[0]));
      const from = Math.min(first < 0 ? index : first, index);
      const to = Math.max(first < 0 ? index : first, index);
      props.onSelection(entries.slice(from, to + 1).map((candidate) => candidate.path), index);
      setPreviewPath(null);
      return;
    }

    props.onSelection([entry.path], index);
    if (entry.kind === "directory") {
      setPreviewPath(null);
      void props.onNavigateDirectory(entry);
    } else {
      setPreviewPath(entry.path);
    }
  }

  function selectKeyboardEntry(entry: FsEntry, index: number, columnIndex: number) {
    props.onSelection([entry.path], index);
    setFocusedColumn(columnIndex);
    if (entry.kind === "directory") {
      setPreviewPath(null);
      void props.onNavigateDirectory(entry);
    } else {
      setPreviewPath(entry.path);
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.column-browser-column[data-column-index="${columnIndex}"] [data-entry-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function focusedEntries() {
    const path = paths()[focusedColumn()];
    return sortedEntries(path ? listingFor(path) : undefined, path);
  }

  function selectedIndex(entries: FsEntry[]) {
    if (!entries.length) return -1;
    const selected = props.selected[0];
    if (selected) {
      const direct = entries.findIndex((entry) => comparePath(entry.path) === comparePath(selected));
      if (direct >= 0) return direct;
    }
    const chained = selectedPathForColumn(focusedColumn());
    return chained ? entries.findIndex((entry) => comparePath(entry.path) === comparePath(chained)) : -1;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!props.active || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const entries = focusedEntries();
    const columnIndex = focusedColumn();
    const index = selectedIndex(entries);
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      props.onSelection(entries.map((entry) => entry.path), entries.length ? 0 : null);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!entries.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(Math.max((index < 0 ? (delta > 0 ? -1 : entries.length) : index) + delta, 0), entries.length - 1);
      selectKeyboardEntry(entries[next], next, columnIndex);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const selected = index >= 0 ? entries[index] : null;
      if (selected?.kind === "directory") {
        const existingChild = paths()[columnIndex + 1];
        if (!existingChild || comparePath(existingChild) !== comparePath(selected.path)) {
          void props.onNavigateDirectory(selected);
        }
        setFocusedColumn(columnIndex + 1);
        scrollToEnd();
      } else if (columnIndex < paths().length - 1) {
        setFocusedColumn(columnIndex + 1);
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      if (columnIndex <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      const previous = columnIndex - 1;
      setFocusedColumn(previous);
      const childPath = paths()[columnIndex];
      const previousEntries = sortedEntries(listingFor(paths()[previous]), paths()[previous]);
      const childIndex = previousEntries.findIndex((entry) => comparePath(entry.path) === comparePath(childPath));
      if (childIndex >= 0) props.onSelection([previousEntries[childIndex].path], childIndex);
      return;
    }

    if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      event.stopPropagation();
      const entry = entries[index];
      if (entry.kind === "directory") void props.onNavigateDirectory(entry);
      else void props.onOpenFile(entry);
    }
  }

  function beginResize(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidth();
    const onMove = (move: PointerEvent) => {
      const next = Math.min(420, Math.max(190, startWidth + move.clientX - startX));
      setColumnWidth(next);
    };
    const onUp = () => {
      localStorage.setItem(WIDTH_KEY, String(columnWidth()));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  onMount(() => window.addEventListener("keydown", handleKeyDown, true));
  onCleanup(() => {
    generation += 1;
    previewGeneration += 1;
    window.removeEventListener("keydown", handleKeyDown, true);
  });

  return (
    <div class="column-browser" ref={scroller} onPointerDown={props.onFocus}>
      <For each={paths()}>{(columnPath, columnIndex) => {
        const entries = () => sortedEntries(listingFor(columnPath), columnPath);
        const chainedSelection = () => selectedPathForColumn(columnIndex());
        return (
          <section
            class="column-browser-column"
            classList={{ focused: props.active && focusedColumn() === columnIndex() }}
            data-column-index={columnIndex()}
            data-column-path={columnPath}
            style={{ width: `${columnWidth()}px` }}
          >
            <div class="column-browser-header">
              <span>{listingFor(columnPath)?.displayName ?? columnPath.split(/[\\/]/).filter(Boolean).pop() ?? columnPath}</span>
              <Show when={loadingPaths().has(columnPath)}><span class="column-browser-spinner" /></Show>
            </div>
            <div
              class="column-browser-list"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  props.onFocus();
                  setFocusedColumn(columnIndex());
                  props.onSelection([], null);
                  setPreviewPath(null);
                }
              }}
            >
              <For each={entries()}>{(entry, index) => {
                const pathSelected = () => !!chainedSelection() && comparePath(chainedSelection()!) === comparePath(entry.path);
                const selected = () => props.selected.some((path) => comparePath(path) === comparePath(entry.path));
                return (
                  <div
                    class="pane-file-row column-browser-row"
                    classList={{ selected: selected(), "path-selected": pathSelected(), "file-row": props.active && selected() }}
                    data-entry-index={index()}
                    data-entry-path={entry.path}
                    data-entry-name={entry.name}
                    data-entry-kind={entry.kind}
                    data-entry-extension={entry.extension ?? ""}
                    data-entry-modified={entry.modifiedMs ?? ""}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEntry(event, entry, entries(), index(), columnIndex());
                    }}
                    onDblClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (entry.kind !== "directory") void props.onOpenFile(entry);
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1 || entry.kind !== "directory") return;
                      event.preventDefault();
                      event.stopPropagation();
                      props.onFocus();
                      void props.onOpenDirectoryInNewTab(entry);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onFocus();
                      setFocusedColumn(columnIndex());
                      if (!selected()) props.onSelection([entry.path], index());
                      props.onContextMenu(event, entry, index());
                    }}
                  >
                    <span class="column-browser-icon"><Icon name={iconForEntry(entry)} size={17} weight={entry.kind === "directory" ? "fill" : "regular"} /></span>
                    <Show when={props.renamePath === entry.path} fallback={<span class="column-browser-name">{entry.name}</span>}>
                      <input
                        class="column-browser-rename"
                        value={props.renameValue}
                        ref={(input) => queueMicrotask(() => { input.focus(); input.select(); })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onInput={(event) => props.onRenameInput(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") props.onCommitRename();
                          if (event.key === "Escape") props.onCancelRename();
                        }}
                        onBlur={props.onCommitRename}
                      />
                    </Show>
                    <Show when={entry.kind === "directory"}><span class="column-browser-disclosure"><Icon name="chevron-right" size={12} /></span></Show>
                  </div>
                );
              }}</For>
              <Show when={!loadingPaths().has(columnPath) && !errors()[columnPath] && entries().length === 0}>
                <div class="column-browser-empty">{props.query ? "No matches" : "Empty folder"}</div>
              </Show>
              <Show when={errors()[columnPath]}>{(message) => <div class="column-browser-error">{message()}</div>}</Show>
            </div>
            <div class="column-browser-resize" onPointerDown={beginResize} />
          </section>
        );
      }}</For>

      <Show when={previewPath()}>
        <aside class="column-browser-preview" style={{ width: `${Math.max(320, columnWidth() + 80)}px` }}>
          <Show when={previewLoading()}><div class="column-preview-loading"><span class="column-browser-spinner" /> Loading preview…</div></Show>
          <Show when={previewError()}>{(message) => <div class="column-browser-error preview-error">{message()}</div>}</Show>
          <Show when={preview()}>{(data) => (
            <>
              <div class="column-preview-stage">
                <Show when={data().kind === "image" && data().dataUrl}>
                  <img class="column-preview-image" src={data().dataUrl ?? ""} alt={data().name} />
                </Show>
                <Show when={data().kind === "pdf" && data().dataUrl}>
                  <iframe class="column-preview-pdf" src={data().dataUrl ?? ""} title={data().name} />
                </Show>
                <Show when={data().kind === "video" && data().dataUrl}>
                  <video class="column-preview-media" src={data().dataUrl ?? ""} controls preload="metadata" />
                </Show>
                <Show when={data().kind === "audio" && data().dataUrl}>
                  <div class="column-preview-audio"><Icon name="music" size={54} /><audio src={data().dataUrl ?? ""} controls preload="metadata" /></div>
                </Show>
                <Show when={data().kind === "text" || data().kind === "markdown"}>
                  <pre class="column-preview-text">{data().text ?? ""}</pre>
                </Show>
                <Show when={!(["image", "pdf", "video", "audio", "text", "markdown"] as string[]).includes(data().kind)}>
                  <div class="column-preview-generic"><Icon name={iconForEntry({ name: data().name, path: data().path, kind: "file", size: data().size, modifiedMs: data().modifiedMs, hidden: false, extension: data().extension })} size={72} /></div>
                </Show>
              </div>
              <div class="column-preview-info">
                <div class="column-preview-name">{data().name}</div>
                <div class="column-preview-kind">{displayKind(data())}</div>
                <div class="column-preview-details">
                  <Show when={data().size !== null}><span>{formatBytes(data().size)}</span></Show>
                  <Show when={data().modifiedMs !== null}><span>{formatModified(data().modifiedMs)}</span></Show>
                  <Show when={data().width && data().height}><span>{data().width} × {data().height}</span></Show>
                </div>
                <For each={data().metadata.slice(0, 6)}>{(item) => (
                  <div class="column-preview-metadata"><span>{item.label}</span><strong>{item.value}</strong></div>
                )}</For>
              </div>
            </>
          )}</Show>
        </aside>
      </Show>
    </div>
  );
}

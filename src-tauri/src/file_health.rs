use crate::queue::{self, JobContext};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use walkdir::WalkDir;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthItem {
    path: String,
    name: String,
    kind: String,
    size: Option<u64>,
    issue: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthReport {
    root: String,
    scanned_files: usize,
    scanned_directories: usize,
    inaccessible_entries: usize,
    total_bytes: u64,
    empty_files: Vec<FileHealthItem>,
    empty_directories: Vec<FileHealthItem>,
    broken_symlinks: Vec<FileHealthItem>,
    largest_files: Vec<FileHealthItem>,
}

fn item(path: &Path, kind: &str, size: Option<u64>, issue: &str) -> FileHealthItem {
    FileHealthItem {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        kind: kind.to_string(),
        size,
        issue: issue.to_string(),
    }
}

fn trim_largest(items: &mut Vec<FileHealthItem>, limit: usize) {
    items.sort_by(|left, right| right.size.unwrap_or(0).cmp(&left.size.unwrap_or(0)));
    items.truncate(limit);
}

fn scan(root: PathBuf, largest_limit: usize, context: Option<&JobContext>) -> Result<FileHealthReport, String> {
    if !root.is_dir() {
        return Err("File Health root is not a directory".into());
    }

    let largest_limit = largest_limit.clamp(10, 250);
    let mut scanned_files = 0usize;
    let mut scanned_directories = 0usize;
    let mut inaccessible_entries = 0usize;
    let mut total_bytes = 0u64;
    let mut empty_files = Vec::new();
    let mut empty_directories = Vec::new();
    let mut broken_symlinks = Vec::new();
    let mut largest_files = Vec::new();
    let mut visited = 0usize;

    for entry in WalkDir::new(&root).follow_links(false) {
        if context.is_some_and(JobContext::cancelled) {
            return Err("File Health scan cancelled".into());
        }

        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                inaccessible_entries += 1;
                continue;
            }
        };
        let path = entry.path();
        visited += 1;

        if entry.file_type().is_symlink() {
            if fs::metadata(path).is_err() {
                broken_symlinks.push(item(path, "symlink", None, "Broken symbolic link"));
            }
            continue;
        }

        if entry.file_type().is_dir() {
            scanned_directories += 1;
            match fs::read_dir(path) {
                Ok(mut children) => match children.next() {
                    None => empty_directories.push(item(path, "directory", None, "Empty folder")),
                    Some(Err(_)) => inaccessible_entries += 1,
                    Some(Ok(_)) => {}
                },
                Err(_) => inaccessible_entries += 1,
            }
        } else if entry.file_type().is_file() {
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => {
                    inaccessible_entries += 1;
                    continue;
                }
            };
            let size = metadata.len();
            scanned_files += 1;
            total_bytes = total_bytes.saturating_add(size);
            if size == 0 {
                empty_files.push(item(path, "file", Some(0), "Empty file"));
            }
            largest_files.push(item(path, "file", Some(size), "Large file"));
            if largest_files.len() > largest_limit.saturating_mul(4) {
                trim_largest(&mut largest_files, largest_limit);
            }
        }

        if visited % 250 == 0 {
            if let Some(context) = context {
                context.progress(
                    None,
                    Some(format!(
                        "Scanned {scanned_files} files · {scanned_directories} folders"
                    )),
                );
            }
        }
    }

    trim_largest(&mut largest_files, largest_limit);
    empty_files.sort_by(|left, right| left.path.cmp(&right.path));
    empty_directories.sort_by(|left, right| left.path.cmp(&right.path));
    broken_symlinks.sort_by(|left, right| left.path.cmp(&right.path));

    if let Some(context) = context {
        context.progress(Some(1.0), Some("File Health scan complete".to_string()));
    }

    Ok(FileHealthReport {
        root: root.to_string_lossy().into_owned(),
        scanned_files,
        scanned_directories,
        inaccessible_entries,
        total_bytes,
        empty_files,
        empty_directories,
        broken_symlinks,
        largest_files,
    })
}

#[tauri::command]
pub async fn scan_file_health(root: String, largest_limit: Option<usize>) -> Result<FileHealthReport, String> {
    tauri::async_runtime::spawn_blocking(move || scan(PathBuf::from(root), largest_limit.unwrap_or(50), None))
        .await
        .map_err(|error| format!("File Health task failed: {error}"))?
}

#[tauri::command]
pub fn enqueue_file_health_scan(
    app: AppHandle,
    root: String,
    largest_limit: Option<usize>,
) -> Result<u64, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("File Health root is not a directory".into());
    }
    let label = format!(
        "File Health · {}",
        root_path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.clone())
    );
    Ok(queue::enqueue_blocking(app, "file-health", label, move |context| {
        scan(root_path, largest_limit.unwrap_or(50), Some(&context))
    }))
}

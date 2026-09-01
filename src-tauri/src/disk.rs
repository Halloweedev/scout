use crate::queue::{self, JobContext};
use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::AppHandle;
use walkdir::WalkDir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSizeItem {
    name: String,
    path: String,
    kind: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSizeScan {
    root: String,
    total_bytes: u64,
    other_bytes: u64,
    items: Vec<FolderSizeItem>,
}

fn directory_size(path: &PathBuf, context: Option<&JobContext>) -> Result<u64, String> {
    let mut size = 0u64;
    for entry in WalkDir::new(path).follow_links(false) {
        if context.is_some_and(JobContext::cancelled) {
            return Err("Folder size scan cancelled".into());
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            continue;
        }
        if let Ok(metadata) = entry.metadata() {
            size = size.saturating_add(metadata.len());
        }
    }
    Ok(size)
}

fn scan(root: PathBuf, max_entries: usize, context: Option<&JobContext>) -> Result<FolderSizeScan, String> {
    if !root.is_dir() {
        return Err("Folder size root is not a directory".into());
    }

    let entries: Vec<_> = fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    let entry_count = entries.len().max(1);
    let mut items = Vec::new();

    for (index, entry) in entries.into_iter().enumerate() {
        if context.is_some_and(JobContext::cancelled) {
            return Err("Folder size scan cancelled".into());
        }
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(context) = context {
            context.progress(
                Some(index as f64 / entry_count as f64),
                Some(format!("Measuring {name}")),
            );
        }
        let (kind, size) = if metadata.is_dir() {
            ("directory", directory_size(&path, context)?)
        } else if metadata.is_file() {
            ("file", metadata.len())
        } else {
            continue;
        };
        items.push(FolderSizeItem {
            name,
            path: path.to_string_lossy().into_owned(),
            kind: kind.to_string(),
            size,
        });
    }

    items.sort_by(|left, right| right.size.cmp(&left.size));
    let total_bytes = items.iter().map(|item| item.size).sum();
    let limit = max_entries.clamp(1, 200);
    let other_bytes = items.iter().skip(limit).map(|item| item.size).sum();
    items.truncate(limit);
    if let Some(context) = context {
        context.progress(Some(1.0), Some("Folder size scan complete".to_string()));
    }

    Ok(FolderSizeScan {
        root: root.to_string_lossy().into_owned(),
        total_bytes,
        other_bytes,
        items,
    })
}

#[tauri::command]
pub async fn analyze_folder_sizes(root: String, max_entries: usize) -> Result<FolderSizeScan, String> {
    tauri::async_runtime::spawn_blocking(move || scan(PathBuf::from(root), max_entries, None))
        .await
        .map_err(|error| format!("Folder size scan task failed: {error}"))?
}

#[tauri::command]
pub fn enqueue_folder_size_scan(app: AppHandle, root: String, max_entries: usize) -> Result<u64, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Folder size root is not a directory".into());
    }
    let label = format!(
        "Folder size map · {}",
        root_path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.clone())
    );
    Ok(queue::enqueue_blocking(app, "disk-map", label, move |context| {
        scan(root_path, max_entries, Some(&context))
    }))
}

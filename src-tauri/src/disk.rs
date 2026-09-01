use serde::Serialize;
use std::{fs, path::PathBuf};
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

fn directory_size(path: &PathBuf) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && !entry.file_type().is_symlink())
        .filter_map(|entry| entry.metadata().ok().map(|metadata| metadata.len()))
        .sum()
}

fn scan(root: PathBuf, max_entries: usize) -> Result<FolderSizeScan, String> {
    if !root.is_dir() {
        return Err("Folder size root is not a directory".into());
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let (kind, size) = if metadata.is_dir() {
            ("directory", directory_size(&path))
        } else if metadata.is_file() {
            ("file", metadata.len())
        } else {
            continue;
        };
        items.push(FolderSizeItem {
            name: entry.file_name().to_string_lossy().into_owned(),
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

    Ok(FolderSizeScan {
        root: root.to_string_lossy().into_owned(),
        total_bytes,
        other_bytes,
        items,
    })
}

#[tauri::command]
pub async fn analyze_folder_sizes(root: String, max_entries: usize) -> Result<FolderSizeScan, String> {
    tauri::async_runtime::spawn_blocking(move || scan(PathBuf::from(root), max_entries))
        .await
        .map_err(|error| format!("Folder size scan task failed: {error}"))?
}

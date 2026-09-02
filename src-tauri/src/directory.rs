use rayon::prelude::*;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    name: String,
    path: String,
    kind: String,
    size: Option<u64>,
    modified_ms: Option<u64>,
    hidden: bool,
    extension: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    path: String,
    parent_path: Option<String>,
    display_name: String,
    entries: Vec<DirectoryEntry>,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn display_name(directory: &Path) -> String {
    directory
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_string(directory))
}

fn sort_entries(entries: &mut [DirectoryEntry]) {
    entries.sort_by(|left, right| {
        let left_directory = left.kind == "directory";
        let right_directory = right.kind == "directory";
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

fn metadata_hidden(name: &str, metadata: &fs::Metadata) -> bool {
    if name.starts_with('.') {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
            return true;
        }
    }

    false
}

fn fast_listing(directory: PathBuf, show_hidden: bool) -> Result<DirectoryListing, String> {
    if !directory.is_dir() {
        return Err(format!("Not a directory: {}", directory.display()));
    }

    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let item = match item {
            Ok(item) => item,
            Err(_) => continue,
        };
        let name = item.file_name().to_string_lossy().into_owned();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        let file_type = match item.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let kind = if file_type.is_dir() {
            "directory"
        } else if file_type.is_file() {
            "file"
        } else if file_type.is_symlink() {
            "symlink"
        } else {
            "other"
        };
        let path = item.path();
        entries.push(DirectoryEntry {
            name,
            path: path_string(&path),
            kind: kind.to_string(),
            size: None,
            modified_ms: None,
            hidden: false,
            extension: path.extension().map(|value| value.to_string_lossy().into_owned()),
        });
    }

    sort_entries(&mut entries);
    Ok(DirectoryListing {
        path: path_string(&directory),
        parent_path: directory.parent().map(path_string),
        display_name: display_name(&directory),
        entries,
    })
}

fn detailed_entry(path: &Path, show_hidden: bool) -> Option<DirectoryEntry> {
    let metadata = fs::symlink_metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    let hidden = metadata_hidden(&name, &metadata);
    if !show_hidden && hidden {
        return None;
    }
    let file_type = metadata.file_type();
    let kind = if file_type.is_dir() {
        "directory"
    } else if file_type.is_file() {
        "file"
    } else if file_type.is_symlink() {
        "symlink"
    } else {
        "other"
    };
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok());

    Some(DirectoryEntry {
        name,
        path: path_string(path),
        kind: kind.to_string(),
        size: file_type.is_file().then_some(metadata.len()),
        modified_ms,
        hidden,
        extension: path.extension().map(|value| value.to_string_lossy().into_owned()),
    })
}

fn full_listing(directory: PathBuf, show_hidden: bool) -> Result<DirectoryListing, String> {
    if !directory.is_dir() {
        return Err(format!("Not a directory: {}", directory.display()));
    }

    let paths: Vec<PathBuf> = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(|item| item.ok().map(|entry| entry.path()))
        .collect();

    let mut entries: Vec<DirectoryEntry> = paths
        .par_iter()
        .filter_map(|path| detailed_entry(path, show_hidden))
        .collect();
    sort_entries(&mut entries);

    Ok(DirectoryListing {
        path: path_string(&directory),
        parent_path: directory.parent().map(path_string),
        display_name: display_name(&directory),
        entries,
    })
}

#[tauri::command]
pub async fn list_directory_fast(path: String, show_hidden: bool) -> Result<DirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || fast_listing(PathBuf::from(path), show_hidden))
        .await
        .map_err(|error| format!("Directory enumeration worker failed: {error}"))?
}

#[tauri::command]
pub async fn list_directory_full(path: String, show_hidden: bool) -> Result<DirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || full_listing(PathBuf::from(path), show_hidden))
        .await
        .map_err(|error| format!("Directory metadata worker failed: {error}"))?
}

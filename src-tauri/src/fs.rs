use crate::{
    history::{HistoryAction, HistorySnapshot, HistoryState},
    tags,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    name: String,
    path: String,
    kind: String,
    size: Option<u64>,
    modified_ms: Option<u64>,
    hidden: bool,
    extension: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    path: String,
    parent_path: Option<String>,
    display_name: String,
    entries: Vec<FsEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialDirectories {
    home: String,
    desktop: Option<String>,
    documents: Option<String>,
    downloads: Option<String>,
    pictures: Option<String>,
    music: Option<String>,
    movies: Option<String>,
    trash: Option<String>,
    icloud: Option<String>,
    drives: Vec<String>,
    network: Option<String>,
    applications: Option<String>,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn is_hidden(name: &str, metadata: &fs::Metadata) -> bool {
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

fn entry_from_path(path: &Path) -> Result<FsEntry, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_string(path));
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

    Ok(FsEntry {
        name: name.clone(),
        path: path_string(path),
        kind: kind.to_string(),
        size: file_type.is_file().then_some(metadata.len()),
        modified_ms,
        hidden: is_hidden(&name, &metadata),
        extension: path.extension().map(|value| value.to_string_lossy().into_owned()),
    })
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name cannot be empty".into());
    }
    if name == "." || name == ".." {
        return Err("Name cannot be . or ..".into());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain path separators".into());
    }

    #[cfg(target_os = "windows")]
    {
        if name.chars().any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')) {
            return Err("Name contains characters Windows does not allow".into());
        }
        if name.ends_with(' ') || name.ends_with('.') {
            return Err("Windows names cannot end with a space or period".into());
        }
        let base = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
        let reserved = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (base.len() == 4
                && (base.starts_with("COM") || base.starts_with("LPT"))
                && base.as_bytes()[3].is_ascii_digit()
                && base.as_bytes()[3] != b'0');
        if reserved {
            return Err("Name is reserved by Windows".into());
        }
    }

    Ok(())
}

fn copy_name(path: &Path, number: usize) -> String {
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "copy".into());
    let suffix = if number == 1 { " copy".to_string() } else { format!(" copy {number}") };
    match path.extension() {
        Some(extension) if path.is_file() => format!("{stem}{suffix}.{}", extension.to_string_lossy()),
        _ => format!("{stem}{suffix}"),
    }
}

fn available_destination(source: &Path, directory: &Path) -> PathBuf {
    if let Some(name) = source.file_name() {
        let direct = directory.join(name);
        if !direct.exists() {
            return direct;
        }
    }

    for number in 1..10_000 {
        let candidate = directory.join(copy_name(source, number));
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!("Scout copy {}", std::process::id()))
}

fn validate_transfer_destination(source: &Path, destination_directory: &Path, operation: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Ok(());
    }
    let source = fs::canonicalize(source).map_err(|error| error.to_string())?;
    let destination = fs::canonicalize(destination_directory).map_err(|error| error.to_string())?;
    if destination == source || destination.starts_with(&source) {
        return Err(format!("Cannot {operation} a folder into itself"));
    }
    Ok(())
}

fn copy_path(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Copying symbolic links is not supported yet: {}", source.display()));
    }

    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|error| error.to_string())?;
        let result = (|| -> Result<(), String> {
            for child in fs::read_dir(source).map_err(|error| error.to_string())? {
                let child = child.map_err(|error| error.to_string())?;
                copy_path(&child.path(), &destination.join(child.file_name()))?;
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(destination);
        }
        result?;
    } else if let Err(error) = fs::copy(source, destination) {
        let _ = fs::remove_file(destination);
        return Err(error.to_string());
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn cleanup_copies(pairs: &[(String, String)]) {
    for (_, destination) in pairs.iter().rev() {
        let path = Path::new(destination);
        let _ = tags::delete_tag_path(path);
        if path.exists() {
            let _ = remove_path(path);
        }
    }
}

fn rollback_moves(pairs: &[(String, String)]) -> Result<(), String> {
    let mut failures = Vec::new();
    for (source, destination) in pairs.iter().rev() {
        if Path::new(destination).exists() {
            if let Err(error) = move_exact(Path::new(destination), Path::new(source)) {
                failures.push(error);
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn move_exact(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err(format!("Source no longer exists: {}", source.display()));
    }
    if destination.exists() {
        return Err(format!("Undo/redo destination already exists: {}", destination.display()));
    }
    if let Err(rename_error) = fs::rename(source, destination) {
        copy_path(source, destination).map_err(|copy_error| {
            format!("Move failed ({rename_error}); cross-device copy also failed ({copy_error})")
        })?;
        if let Err(remove_error) = remove_path(source) {
            let _ = remove_path(destination);
            return Err(format!("Move copied the item but could not remove the source: {remove_error}"));
        }
    }
    let _ = tags::move_tag_path(source, destination);
    Ok(())
}

fn apply_history_action(action: &HistoryAction, reverse: bool) -> Result<(), String> {
    match action {
        HistoryAction::Rename { from, to } => {
            let (source, destination) = if reverse { (to, from) } else { (from, to) };
            move_exact(Path::new(source), Path::new(destination))
        }
        HistoryAction::CreateDirectory { path } => {
            let path = Path::new(path);
            if reverse {
                fs::remove_dir(path).map_err(|error| {
                    format!("Could not undo folder creation. Scout only removes it if still empty: {error}")
                })
            } else if path.exists() {
                Err(format!("Cannot redo folder creation because it already exists: {}", path.display()))
            } else {
                fs::create_dir(path).map_err(|error| error.to_string())
            }
        }
        HistoryAction::Copy { pairs } => {
            if reverse {
                for (_, destination) in pairs.iter().rev() {
                    let destination = Path::new(destination);
                    if destination.exists() {
                        let _ = tags::delete_tag_path(destination);
                        remove_path(destination)?;
                    }
                }
                Ok(())
            } else {
                let mut completed: Vec<(String, String)> = Vec::new();
                for (source, destination) in pairs {
                    let source_path = Path::new(source);
                    let destination_path = Path::new(destination);
                    if destination_path.exists() {
                        cleanup_copies(&completed);
                        return Err(format!("Cannot redo copy because destination exists: {}", destination_path.display()));
                    }
                    if let Err(error) = copy_path(source_path, destination_path) {
                        cleanup_copies(&completed);
                        return Err(error);
                    }
                    let _ = tags::copy_tag_path(source_path, destination_path);
                    completed.push((source.clone(), destination.clone()));
                }
                Ok(())
            }
        }
        HistoryAction::Move { pairs } => {
            if reverse {
                for (source, destination) in pairs.iter().rev() {
                    move_exact(Path::new(destination), Path::new(source))?;
                }
            } else {
                for (source, destination) in pairs {
                    move_exact(Path::new(source), Path::new(destination))?;
                }
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub fn special_directories() -> Result<SpecialDirectories, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve the home directory".to_string())?;
    let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    let icloud_path = icloud.is_dir().then(|| path_string(&icloud));
    let trash = home.join(".Trash");
    let trash_path = trash.is_dir().then(|| path_string(&trash));
    let drives = std::fs::read_dir("/Volumes")
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let p = e.path();
                    // filter out hidden and non-directory, keep actual volumes
                    if p.is_dir() {
                        Some(path_string(&p))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SpecialDirectories {
        home: path_string(&home),
        desktop: dirs::desktop_dir().map(|path| path_string(&path)),
        documents: dirs::document_dir().map(|path| path_string(&path)),
        downloads: dirs::download_dir().map(|path| path_string(&path)),
        pictures: dirs::picture_dir().map(|path| path_string(&path)),
        music: dirs::audio_dir().map(|path| path_string(&path)),
        movies: dirs::video_dir().map(|path| path_string(&path)),
        trash: trash_path,
        icloud: icloud_path,
        drives,
        network: Some("/Network".to_string()),
        applications: Some("/Applications".to_string()),
    })
}

#[tauri::command]
pub fn list_directory(path: String, show_hidden: bool) -> Result<DirectoryListing, String> {
    use rayon::prelude::*;
    let directory = PathBuf::from(&path);
    if !directory.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    // Nautilus: async enumerator, not blocking UI. We collect DirEntries first (fast), then parallel stat.
    let dir_entries: Vec<fs::DirEntry> = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(|e| e.ok())
        .collect();

    // Fast path: use DirEntry::file_type to avoid extra symlink_metadata where possible
    let mut entries: Vec<FsEntry> = dir_entries
        .par_iter()
        .filter_map(|entry| {
            let path = entry.path();
            // Use DirEntry metadata if available, fallback to symlink_metadata
            let ft = entry.file_type().ok()?;
            let name = path.file_name()?.to_string_lossy().into_owned();
            if !show_hidden && name.starts_with('.') {
                return None;
            }
            // Still need full metadata for size/modified, but file_type is already known
            let metadata = fs::symlink_metadata(&path).ok()?;
            let hidden = is_hidden(&name, &metadata);
            if !show_hidden && hidden {
                return None;
            }
            let kind = if ft.is_dir() {
                "directory"
            } else if ft.is_file() {
                "file"
            } else if ft.is_symlink() {
                "symlink"
            } else {
                "other"
            };
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
                .and_then(|d| u64::try_from(d.as_millis()).ok());
            Some(FsEntry {
                name: name.clone(),
                path: path_string(&path),
                kind: kind.to_string(),
                size: ft.is_file().then_some(metadata.len()),
                modified_ms,
                hidden,
                extension: path.extension().map(|v| v.to_string_lossy().into_owned()),
            })
        })
        .collect();

    entries.sort_by(|left, right| {
        let left_directory = left.kind == "directory";
        let right_directory = right.kind == "directory";
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let display_name = directory
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_string(&directory));

    Ok(DirectoryListing {
        path: path_string(&directory),
        parent_path: directory.parent().map(path_string),
        display_name,
        entries,
    })
}

#[tauri::command]
pub fn rename_entry(path: String, new_name: String, history: State<'_, HistoryState>) -> Result<FsEntry, String> {
    validate_name(&new_name)?;
    let source = PathBuf::from(&path);
    let parent = source.parent().ok_or_else(|| "Cannot rename this path".to_string())?;
    let destination = parent.join(&new_name);
    if destination.exists() {
        return Err("An item with that name already exists".into());
    }
    let old_name = source.file_name().map(|value| value.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
    move_exact(&source, &destination)?;
    history.record(
        "rename",
        format!("Renamed {old_name} to {new_name}"),
        HistoryAction::Rename { from: path_string(&source), to: path_string(&destination) },
    );
    entry_from_path(&destination)
}

#[tauri::command]
pub fn duplicate_entries(paths: Vec<String>, history: State<'_, HistoryState>) -> Result<Vec<FsEntry>, String> {
    let mut results = Vec::with_capacity(paths.len());
    let mut pairs = Vec::with_capacity(paths.len());
    for path in paths {
        let source = PathBuf::from(&path);
        let parent = match source.parent() {
            Some(parent) => parent,
            None => {
                cleanup_copies(&pairs);
                return Err("Cannot duplicate this path".into());
            }
        };
        let destination = available_destination(&source, parent);
        if let Err(error) = copy_path(&source, &destination) {
            cleanup_copies(&pairs);
            return Err(error);
        }
        let _ = tags::copy_tag_path(&source, &destination);
        match entry_from_path(&destination) {
            Ok(entry) => results.push(entry),
            Err(error) => {
                let _ = tags::delete_tag_path(&destination);
                let _ = remove_path(&destination);
                cleanup_copies(&pairs);
                return Err(error);
            }
        }
        pairs.push((path_string(&source), path_string(&destination)));
    }
    if !pairs.is_empty() {
        history.record(
            "duplicate",
            format!("Duplicated {} {}", pairs.len(), if pairs.len() == 1 { "item" } else { "items" }),
            HistoryAction::Copy { pairs },
        );
    }
    Ok(results)
}

#[tauri::command]
pub fn copy_entries(paths: Vec<String>, destination: String, history: State<'_, HistoryState>) -> Result<Vec<FsEntry>, String> {
    let destination_directory = PathBuf::from(destination);
    if !destination_directory.is_dir() {
        return Err("Copy destination is not a directory".into());
    }
    let mut results = Vec::with_capacity(paths.len());
    let mut pairs = Vec::with_capacity(paths.len());
    for path in paths {
        let source = PathBuf::from(&path);
        if let Err(error) = validate_transfer_destination(&source, &destination_directory, "copy") {
            cleanup_copies(&pairs);
            return Err(error);
        }
        let target = available_destination(&source, &destination_directory);
        if let Err(error) = copy_path(&source, &target) {
            cleanup_copies(&pairs);
            return Err(error);
        }
        let _ = tags::copy_tag_path(&source, &target);
        match entry_from_path(&target) {
            Ok(entry) => results.push(entry),
            Err(error) => {
                let _ = tags::delete_tag_path(&target);
                let _ = remove_path(&target);
                cleanup_copies(&pairs);
                return Err(error);
            }
        }
        pairs.push((path_string(&source), path_string(&target)));
    }
    if !pairs.is_empty() {
        history.record(
            "copy",
            format!("Copied {} {}", pairs.len(), if pairs.len() == 1 { "item" } else { "items" }),
            HistoryAction::Copy { pairs },
        );
    }
    Ok(results)
}

#[tauri::command]
pub fn move_entries(paths: Vec<String>, destination: String, history: State<'_, HistoryState>) -> Result<Vec<FsEntry>, String> {
    let destination_directory = PathBuf::from(destination);
    if !destination_directory.is_dir() {
        return Err("Move destination is not a directory".into());
    }

    let mut results = Vec::with_capacity(paths.len());
    let mut pairs = Vec::new();
    for path in paths {
        let source = PathBuf::from(&path);
        if source.parent() == Some(destination_directory.as_path()) {
            results.push(entry_from_path(&source)?);
            continue;
        }
        if let Err(error) = validate_transfer_destination(&source, &destination_directory, "move") {
            if let Err(rollback_error) = rollback_moves(&pairs) {
                return Err(format!("{error}; rollback also failed: {rollback_error}"));
            }
            return Err(error);
        }
        let target = available_destination(&source, &destination_directory);
        if let Err(error) = move_exact(&source, &target) {
            if let Err(rollback_error) = rollback_moves(&pairs) {
                return Err(format!("{error}; rollback also failed: {rollback_error}"));
            }
            return Err(error);
        }
        match entry_from_path(&target) {
            Ok(entry) => results.push(entry),
            Err(error) => {
                let current_pair = (path_string(&source), path_string(&target));
                pairs.push(current_pair);
                if let Err(rollback_error) = rollback_moves(&pairs) {
                    return Err(format!("{error}; rollback also failed: {rollback_error}"));
                }
                return Err(error);
            }
        }
        pairs.push((path_string(&source), path_string(&target)));
    }
    if !pairs.is_empty() {
        history.record(
            "move",
            format!("Moved {} {}", pairs.len(), if pairs.len() == 1 { "item" } else { "items" }),
            HistoryAction::Move { pairs },
        );
    }
    Ok(results)
}

#[tauri::command]
pub fn trash_entries(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let source = PathBuf::from(&path);
        trash::delete(&source).map_err(|error| error.to_string())?;
        let _ = tags::delete_tag_path(&source);
    }
    Ok(())
}

#[tauri::command]
pub fn create_folder(directory: String, history: State<'_, HistoryState>) -> Result<FsEntry, String> {
    let directory = PathBuf::from(directory);
    if !directory.is_dir() {
        return Err("Folder destination is not a directory".into());
    }
    let base = directory.join("New Folder");
    let target = if !base.exists() {
        base
    } else {
        (2..10_000)
            .map(|number| directory.join(format!("New Folder {number}")))
            .find(|candidate| !candidate.exists())
            .ok_or_else(|| "Could not find an available folder name".to_string())?
    };
    fs::create_dir(&target).map_err(|error| error.to_string())?;
    history.record(
        "create-folder",
        format!("Created {}", target.file_name().map(|value| value.to_string_lossy()).unwrap_or_default()),
        HistoryAction::CreateDirectory { path: path_string(&target) },
    );
    entry_from_path(&target)
}

#[tauri::command]
pub fn open_entry(path: String) -> Result<(), String> {
    open::that(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn undo_last_operation(history: State<'_, HistoryState>) -> Result<HistorySnapshot, String> {
    let operation = history.peek_undo().ok_or_else(|| "Nothing to undo".to_string())?;
    apply_history_action(&operation.action, true)?;
    history.commit_undo(operation.id)?;
    history.snapshot()
}

#[tauri::command]
pub fn redo_last_operation(history: State<'_, HistoryState>) -> Result<HistorySnapshot, String> {
    let operation = history.peek_redo().ok_or_else(|| "Nothing to redo".to_string())?;
    apply_history_action(&operation.action, false)?;
    history.commit_redo(operation.id)?;
    history.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("scout-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn rejects_invalid_names() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
        assert!(validate_name(".").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("a\\b").is_err());
        assert!(validate_name("normal.txt").is_ok());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_windows_reserved_names() {
        assert!(validate_name("CON").is_err());
        assert!(validate_name("nul.txt").is_err());
        assert!(validate_name("COM1.log").is_err());
        assert!(validate_name("report?.txt").is_err());
        assert!(validate_name("trailing.").is_err());
    }

    #[test]
    fn rejects_copying_directory_into_descendant() {
        let root = test_directory("descendant");
        let source = root.join("source");
        let child = source.join("child");
        fs::create_dir_all(&child).expect("create nested source");

        assert!(validate_transfer_destination(&source, &child, "copy").is_err());
        assert!(validate_transfer_destination(&source, &root, "copy").is_ok());

        fs::remove_dir_all(root).expect("cleanup test directory");
    }

    #[test]
    fn copies_nested_directories() {
        let root = test_directory("nested-copy");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("nested")).expect("create source tree");
        fs::write(source.join("nested").join("hello.txt"), b"hello").expect("write source file");

        copy_path(&source, &destination).expect("copy source tree");
        assert_eq!(fs::read(destination.join("nested").join("hello.txt")).expect("read copied file"), b"hello");

        fs::remove_dir_all(root).expect("cleanup test directory");
    }

    #[cfg(unix)]
    #[test]
    fn failed_recursive_copy_removes_partial_destination() {
        use std::os::unix::fs::symlink;

        let root = test_directory("copy-cleanup");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).expect("create source");
        fs::write(source.join("ok.txt"), b"ok").expect("write source file");
        symlink(source.join("ok.txt"), source.join("link.txt")).expect("create symlink");

        assert!(copy_path(&source, &destination).is_err());
        assert!(!destination.exists());

        fs::remove_dir_all(root).expect("cleanup test directory");
    }
}

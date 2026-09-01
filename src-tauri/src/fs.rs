use crate::history::{HistoryAction, HistorySnapshot, HistoryState};
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
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain path separators".into());
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

fn copy_path(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Copying symbolic links is not supported yet: {}", source.display()));
    }

    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|error| error.to_string())?;
        for child in fs::read_dir(source).map_err(|error| error.to_string())? {
            let child = child.map_err(|error| error.to_string())?;
            copy_path(&child.path(), &destination.join(child.file_name()))?;
        }
    } else {
        fs::copy(source, destination).map_err(|error| error.to_string())?;
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
        remove_path(source)?;
    }
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
                        remove_path(destination)?;
                    }
                }
                Ok(())
            } else {
                let mut completed: Vec<PathBuf> = Vec::new();
                for (source, destination) in pairs {
                    let source = Path::new(source);
                    let destination = Path::new(destination);
                    if destination.exists() {
                        for path in completed.iter().rev() {
                            let _ = remove_path(path);
                        }
                        return Err(format!("Cannot redo copy because destination exists: {}", destination.display()));
                    }
                    if let Err(error) = copy_path(source, destination) {
                        for path in completed.iter().rev() {
                            let _ = remove_path(path);
                        }
                        return Err(error);
                    }
                    completed.push(destination.to_path_buf());
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
    Ok(SpecialDirectories {
        home: path_string(&home),
        desktop: dirs::desktop_dir().map(|path| path_string(&path)),
        documents: dirs::document_dir().map(|path| path_string(&path)),
        downloads: dirs::download_dir().map(|path| path_string(&path)),
        pictures: dirs::picture_dir().map(|path| path_string(&path)),
    })
}

#[tauri::command]
pub fn list_directory(path: String, show_hidden: bool) -> Result<DirectoryListing, String> {
    let directory = PathBuf::from(&path);
    if !directory.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let mut entries = Vec::new();
    for child in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let child = child.map_err(|error| error.to_string())?;
        let entry = entry_from_path(&child.path())?;
        if show_hidden || !entry.hidden {
            entries.push(entry);
        }
    }

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
    fs::rename(&source, &destination).map_err(|error| error.to_string())?;
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
        let parent = source.parent().ok_or_else(|| "Cannot duplicate this path".to_string())?;
        let destination = available_destination(&source, parent);
        copy_path(&source, &destination)?;
        pairs.push((path_string(&source), path_string(&destination)));
        results.push(entry_from_path(&destination)?);
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
        let target = available_destination(&source, &destination_directory);
        copy_path(&source, &target)?;
        pairs.push((path_string(&source), path_string(&target)));
        results.push(entry_from_path(&target)?);
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
        if source == destination_directory || destination_directory.starts_with(&source) {
            return Err("Cannot move a folder into itself".into());
        }
        let target = available_destination(&source, &destination_directory);
        if let Err(rename_error) = fs::rename(&source, &target) {
            copy_path(&source, &target).map_err(|copy_error| {
                format!("Move failed ({rename_error}); cross-device copy also failed ({copy_error})")
            })?;
            remove_path(&source)?;
        }
        pairs.push((path_string(&source), path_string(&target)));
        results.push(entry_from_path(&target)?);
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
        trash::delete(PathBuf::from(path)).map_err(|error| error.to_string())?;
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

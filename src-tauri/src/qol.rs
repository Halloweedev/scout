use crate::tags;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymlinkResult {
    source: String,
    link: String,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn remove_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn ensure_safe_removal(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() || path.parent().is_none() {
        return Err("Scout refuses to permanently delete a filesystem root".into());
    }
    Ok(())
}

fn link_name(source: &Path, number: usize) -> String {
    let suffix = if number == 1 { " link".to_string() } else { format!(" link {number}") };
    let metadata = fs::symlink_metadata(source).ok();
    let is_file = metadata.as_ref().is_some_and(|value| value.is_file());
    if is_file {
        if let Some(extension) = source.extension() {
            let stem = source
                .file_stem()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "item".into());
            return format!("{stem}{suffix}.{}", extension.to_string_lossy());
        }
    }
    let name = source
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "item".into());
    format!("{name}{suffix}")
}

fn available_link_path(source: &Path, destination: &Path) -> Result<PathBuf, String> {
    for number in 1..10_000 {
        let candidate = destination.join(link_name(source, number));
        if fs::symlink_metadata(&candidate).is_err() {
            return Ok(candidate);
        }
    }
    Err("Could not find an available symlink name".into())
}

#[cfg(unix)]
fn create_platform_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(source, destination).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn create_platform_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::fs::{symlink_dir, symlink_file};
    let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        symlink_dir(source, destination).map_err(|error| {
            format!("Could not create folder symlink. Windows may require Developer Mode or elevated privileges: {error}")
        })
    } else {
        symlink_file(source, destination).map_err(|error| {
            format!("Could not create file symlink. Windows may require Developer Mode or elevated privileges: {error}")
        })
    }
}

#[tauri::command]
pub fn delete_entries_permanently(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No items selected".into());
    }
    for value in paths {
        let path = PathBuf::from(&value);
        ensure_safe_removal(&path)?;
        remove_path(&path)?;
        let _ = tags::delete_tag_path(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn create_symlinks(paths: Vec<String>, destination: String) -> Result<Vec<SymlinkResult>, String> {
    if paths.is_empty() {
        return Err("No items selected".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Symlink destination is not a directory".into());
    }

    let mut created = Vec::with_capacity(paths.len());
    for value in paths {
        let source = PathBuf::from(&value);
        fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
        let link = available_link_path(&source, &destination)?;
        if let Err(error) = create_platform_symlink(&source, &link) {
            for item in created.iter().rev() {
                let _ = fs::remove_file(Path::new(&item.link));
            }
            return Err(error);
        }
        created.push(SymlinkResult {
            source: path_string(&source),
            link: path_string(&link),
        });
    }
    Ok(created)
}

#[tauri::command]
pub fn symlink_target(path: String) -> Result<String, String> {
    let source = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_symlink() {
        return Err("The selected item is not a symbolic link".into());
    }
    let target = fs::read_link(&source).map_err(|error| error.to_string())?;
    let resolved = if target.is_absolute() {
        target
    } else {
        source.parent().unwrap_or_else(|| Path::new("")).join(target)
    };
    Ok(path_string(&resolved))
}

fn ide_program(ide: &str) -> Result<(&'static str, &'static str), String> {
    match ide {
        "vscode" => Ok(("code", "Visual Studio Code")),
        "zed" => Ok(("zed", "Zed")),
        "cursor" => Ok(("cursor", "Cursor")),
        _ => Err("Unsupported IDE".into()),
    }
}

#[tauri::command]
pub fn open_in_ide(path: String, ide: String) -> Result<(), String> {
    let source = PathBuf::from(&path);
    fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
    let (program, app_name) = ide_program(&ide)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg(app_name)
            .arg(&source)
            .spawn()
            .map_err(|error| format!("Could not open {app_name}: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_name;
        Command::new(program)
            .arg(&source)
            .spawn()
            .map_err(|error| format!("Could not launch {program}: {error}"))?;
        Ok(())
    }
}

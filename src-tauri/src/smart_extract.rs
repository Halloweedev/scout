use crate::queue::{self, JobContext};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;
use zip::ZipArchive;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartExtractResult {
    archive: String,
    destination: String,
    entries: usize,
    layout: String,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn available_directory(directory: &Path, base_name: &str) -> PathBuf {
    let direct = directory.join(base_name);
    if !direct.exists() {
        return direct;
    }
    for number in 2..10_000 {
        let candidate = directory.join(format!("{base_name} {number}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{base_name}-{}", std::process::id()))
}

fn top_component(path: &Path) -> Option<String> {
    path.components().find_map(|component| match component {
        Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
        _ => None,
    })
}

fn archive_layout(archive: &mut ZipArchive<File>, destination: &Path) -> Result<(PathBuf, String, Option<String>), String> {
    let mut roots = BTreeSet::new();
    let mut has_nested_entry = false;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_symlink() {
            continue;
        }
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        if let Some(root) = top_component(&enclosed) {
            roots.insert(root);
        }
        if enclosed.components().filter(|component| matches!(component, Component::Normal(_))).count() > 1 {
            has_nested_entry = true;
        }
    }

    if roots.len() == 1 && has_nested_entry {
        let root_name = roots.iter().next().cloned().unwrap_or_default();
        let root_target = destination.join(&root_name);
        if !root_name.is_empty() && !root_target.exists() {
            return Ok((destination.to_path_buf(), "single-root".into(), Some(root_name)));
        }
    }

    Ok((PathBuf::new(), "wrapped".into(), None))
}

fn totals(archive: &mut ZipArchive<File>, context: &JobContext) -> Result<(usize, u64), String> {
    let mut entries = 0usize;
    let mut bytes = 0u64;
    for index in 0..archive.len() {
        if context.cancelled() {
            return Err("Smart Extract cancelled".into());
        }
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_symlink() || entry.enclosed_name().is_none() {
            continue;
        }
        entries += 1;
        if entry.is_file() {
            bytes = bytes.saturating_add(entry.size());
        }
    }
    Ok((entries, bytes))
}

fn copy_with_progress<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    context: &JobContext,
    copied: &mut u64,
    total: u64,
    entries_done: usize,
    entries_total: usize,
) -> Result<(), String> {
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        if context.cancelled() {
            return Err("Smart Extract cancelled".into());
        }
        let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
        *copied = copied.saturating_add(read as u64);
        let progress = if total > 0 {
            (*copied as f64 / total as f64).clamp(0.0, 1.0)
        } else if entries_total > 0 {
            (entries_done as f64 / entries_total as f64).clamp(0.0, 1.0)
        } else {
            1.0
        };
        context.progress(Some(progress), Some(format!("Extracting {entries_done}/{entries_total} items")));
    }
    Ok(())
}

fn remove_created_root(base: &Path, single_root: Option<&str>) {
    if let Some(root) = single_root {
        let _ = fs::remove_dir_all(base.join(root));
    } else {
        let _ = fs::remove_dir_all(base);
    }
}

fn extract(path: String, destination: String, context: &JobContext) -> Result<SmartExtractResult, String> {
    let archive_path = PathBuf::from(&path);
    if archive_path.extension().map(|value| value.to_string_lossy().to_ascii_lowercase()).as_deref() != Some("zip") {
        return Err("Smart Extract currently supports ZIP archives".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Extraction destination is not a directory".into());
    }
    let file = File::open(&archive_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("Could not read ZIP archive: {error}"))?;
    context.progress(None, Some("Inspecting archive layout…".into()));
    let (suggested_base, layout, single_root) = archive_layout(&mut archive, &destination)?;

    let base_name = archive_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Archive".to_string());
    let extraction_base = if layout == "single-root" {
        suggested_base
    } else {
        let wrapper = available_directory(&destination, &base_name);
        fs::create_dir(&wrapper).map_err(|error| error.to_string())?;
        wrapper
    };

    let (entries_total, bytes_total) = totals(&mut archive, context)?;
    let mut copied = 0u64;
    let mut entries_done = 0usize;
    let result = (|| -> Result<(), String> {
        for index in 0..archive.len() {
            if context.cancelled() {
                return Err("Smart Extract cancelled".into());
            }
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            if entry.is_symlink() {
                continue;
            }
            let Some(enclosed) = entry.enclosed_name() else {
                continue;
            };
            let target = extraction_base.join(enclosed);
            if entry.is_dir() {
                fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                if target.exists() {
                    return Err(format!("Smart Extract would overwrite an existing item: {}", target.display()));
                }
                let mut output = File::create(&target).map_err(|error| error.to_string())?;
                copy_with_progress(
                    &mut entry,
                    &mut output,
                    context,
                    &mut copied,
                    bytes_total,
                    entries_done,
                    entries_total,
                )?;
            }
            entries_done += 1;
            let progress = if bytes_total > 0 {
                (copied as f64 / bytes_total as f64).clamp(0.0, 1.0)
            } else if entries_total > 0 {
                (entries_done as f64 / entries_total as f64).clamp(0.0, 1.0)
            } else {
                1.0
            };
            context.progress(Some(progress), Some(format!("Extracted {entries_done}/{entries_total} items")));
        }
        Ok(())
    })();

    if let Err(error) = result {
        remove_created_root(&extraction_base, if layout == "single-root" { single_root.as_deref() } else { None });
        return Err(error);
    }

    context.progress(Some(1.0), Some(format!("Extracted {entries_done} items")));
    let final_destination = if layout == "single-root" {
        single_root
            .as_deref()
            .map(|root| extraction_base.join(root))
            .unwrap_or_else(|| extraction_base.clone())
    } else {
        extraction_base.clone()
    };
    Ok(SmartExtractResult {
        archive: path,
        destination: path_string(&final_destination),
        entries: entries_done,
        layout,
    })
}

#[tauri::command]
pub fn enqueue_smart_zip_extraction(app: AppHandle, path: String, destination: String) -> Result<u64, String> {
    let name = Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive.zip".into());
    Ok(queue::enqueue_blocking(app, "archive", format!("Smart Extract · {name}"), move |context| {
        extract(path, destination, &context)
    }))
}

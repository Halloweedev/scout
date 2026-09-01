use crate::queue::{self, JobContext};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOperationResult {
    path: String,
    entries: usize,
}

struct ProgressState {
    total_bytes: u64,
    total_entries: usize,
    bytes: u64,
    entries: usize,
    verb: &'static str,
}

impl ProgressState {
    fn report(&self, context: &JobContext) {
        let progress = if self.total_bytes > 0 {
            Some((self.bytes as f64 / self.total_bytes as f64).clamp(0.0, 1.0))
        } else if self.total_entries > 0 {
            Some((self.entries as f64 / self.total_entries as f64).clamp(0.0, 1.0))
        } else {
            Some(1.0)
        };
        context.progress(
            progress,
            Some(format!(
                "{} {}/{} items · {}",
                self.verb,
                self.entries.min(self.total_entries),
                self.total_entries,
                format_bytes(self.bytes)
            )),
        );
    }

    fn finish_entry(&mut self, context: &JobContext) {
        self.entries = self.entries.saturating_add(1);
        self.report(context);
    }
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn available_archive_path(directory: &Path, base_name: &str) -> PathBuf {
    let direct = directory.join(format!("{base_name}.zip"));
    if !direct.exists() {
        return direct;
    }
    for number in 2..10_000 {
        let candidate = directory.join(format!("{base_name} {number}.zip"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{base_name}-{}.zip", std::process::id()))
}

fn available_extract_directory(directory: &Path, base_name: &str) -> PathBuf {
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

fn zip_entry_name(path: &Path, parent: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(parent).map_err(|error| error.to_string())?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn source_totals(paths: &[String], context: &JobContext) -> Result<(usize, u64), String> {
    let mut entries = 0usize;
    let mut bytes = 0u64;
    for raw_path in paths {
        if context.cancelled() {
            return Err("ZIP creation cancelled".into());
        }
        let source = PathBuf::from(raw_path);
        if !source.exists() {
            return Err(format!("Item no longer exists: {}", source.display()));
        }
        if source.is_file() {
            entries += 1;
            bytes = bytes.saturating_add(fs::metadata(&source).map_err(|error| error.to_string())?.len());
            continue;
        }
        for entry in WalkDir::new(&source).follow_links(false) {
            if context.cancelled() {
                return Err("ZIP creation cancelled".into());
            }
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.file_type().is_symlink() {
                continue;
            }
            entries += 1;
            if entry.file_type().is_file() {
                bytes = bytes.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
            }
        }
    }
    Ok((entries, bytes))
}

fn copy_with_progress<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    context: &JobContext,
    progress: &mut ProgressState,
) -> Result<(), String> {
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        if context.cancelled() {
            return Err("Archive operation cancelled".into());
        }
        let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
        progress.bytes = progress.bytes.saturating_add(read as u64);
        progress.report(context);
    }
    Ok(())
}

fn add_source(
    writer: &mut ZipWriter<File>,
    source: &Path,
    context: &JobContext,
    progress: &mut ProgressState,
) -> Result<(), String> {
    let parent = source.parent().ok_or_else(|| "Cannot archive this path".to_string())?;
    if source.is_file() {
        let name = zip_entry_name(source, parent)?;
        let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(metadata.len() > u32::MAX as u64);
        writer.start_file(name, options).map_err(|error| error.to_string())?;
        let mut file = File::open(source).map_err(|error| error.to_string())?;
        copy_with_progress(&mut file, writer, context, progress)?;
        progress.finish_entry(context);
        return Ok(());
    }

    for entry in WalkDir::new(source).follow_links(false) {
        if context.cancelled() {
            return Err("ZIP creation cancelled".into());
        }
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_symlink() {
            continue;
        }
        let path = entry.path();
        let mut name = zip_entry_name(path, parent)?;
        if entry.file_type().is_dir() {
            if !name.ends_with('/') {
                name.push('/');
            }
            let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            writer.add_directory(name, options).map_err(|error| error.to_string())?;
        } else if entry.file_type().is_file() {
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .large_file(metadata.len() > u32::MAX as u64);
            writer.start_file(name, options).map_err(|error| error.to_string())?;
            let mut file = File::open(path).map_err(|error| error.to_string())?;
            copy_with_progress(&mut file, writer, context, progress)?;
        }
        progress.finish_entry(context);
    }
    Ok(())
}

fn create_zip_blocking(paths: Vec<String>, destination: String, context: &JobContext) -> Result<ArchiveOperationResult, String> {
    if paths.is_empty() {
        return Err("Choose at least one item to archive".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Archive destination is not a directory".into());
    }

    context.progress(None, Some("Scanning items…".to_string()));
    let (total_entries, total_bytes) = source_totals(&paths, context)?;
    if context.cancelled() {
        return Err("ZIP creation cancelled".into());
    }

    let first = PathBuf::from(&paths[0]);
    let base_name = if paths.len() == 1 {
        first
            .file_stem()
            .or_else(|| first.file_name())
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Archive".to_string())
    } else {
        "Archive".to_string()
    };
    let output = available_archive_path(&destination, &base_name);
    let file = File::create(&output).map_err(|error| error.to_string())?;
    let mut writer = ZipWriter::new(file);
    let mut progress = ProgressState {
        total_bytes,
        total_entries,
        bytes: 0,
        entries: 0,
        verb: "Archived",
    };
    progress.report(context);

    for raw_path in paths {
        let source = PathBuf::from(raw_path);
        if let Err(error) = add_source(&mut writer, &source, context, &mut progress) {
            drop(writer);
            let _ = fs::remove_file(&output);
            return Err(error);
        }
    }
    if context.cancelled() {
        drop(writer);
        let _ = fs::remove_file(&output);
        return Err("ZIP creation cancelled".into());
    }
    writer.finish().map_err(|error| {
        let _ = fs::remove_file(&output);
        error.to_string()
    })?;
    context.progress(Some(1.0), Some(format!("Archived {} items · {}", progress.entries, format_bytes(progress.bytes))));
    Ok(ArchiveOperationResult { path: path_string(&output), entries: progress.entries })
}

fn archive_totals(archive: &mut ZipArchive<File>, context: &JobContext) -> Result<(usize, u64), String> {
    let mut entries = 0usize;
    let mut bytes = 0u64;
    for index in 0..archive.len() {
        if context.cancelled() {
            return Err("ZIP extraction cancelled".into());
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

fn extract_zip_blocking(path: String, destination: String, context: &JobContext) -> Result<ArchiveOperationResult, String> {
    let archive_path = PathBuf::from(&path);
    if archive_path.extension().map(|value| value.to_string_lossy().to_ascii_lowercase()).as_deref() != Some("zip") {
        return Err("Only ZIP extraction is supported here".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Extraction destination is not a directory".into());
    }

    let base_name = archive_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Archive".to_string());
    let output = available_extract_directory(&destination, &base_name);
    fs::create_dir(&output).map_err(|error| error.to_string())?;

    let result = (|| -> Result<ArchiveOperationResult, String> {
        let file = File::open(&archive_path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|error| format!("Could not read ZIP archive: {error}"))?;
        context.progress(None, Some("Reading archive…".to_string()));
        let (total_entries, total_bytes) = archive_totals(&mut archive, context)?;
        let mut progress = ProgressState {
            total_bytes,
            total_entries,
            bytes: 0,
            entries: 0,
            verb: "Extracted",
        };
        progress.report(context);

        for index in 0..archive.len() {
            if context.cancelled() {
                return Err("ZIP extraction cancelled".into());
            }
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            if entry.is_symlink() {
                continue;
            }
            let Some(enclosed) = entry.enclosed_name() else {
                continue;
            };
            let target = output.join(enclosed);
            if entry.is_dir() {
                fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                let mut output_file = File::create(&target).map_err(|error| error.to_string())?;
                copy_with_progress(&mut entry, &mut output_file, context, &mut progress)?;
            }
            progress.finish_entry(context);
        }
        context.progress(Some(1.0), Some(format!("Extracted {} items · {}", progress.entries, format_bytes(progress.bytes))));
        Ok(ArchiveOperationResult { path: path_string(&output), entries: progress.entries })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&output);
    }
    result
}

#[tauri::command]
pub fn enqueue_zip_creation(app: AppHandle, paths: Vec<String>, destination: String) -> Result<u64, String> {
    let label = if paths.len() == 1 {
        let name = Path::new(&paths[0])
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "item".to_string());
        format!("Create ZIP · {name}")
    } else {
        format!("Create ZIP · {} items", paths.len())
    };
    Ok(queue::enqueue_blocking(app, "archive", label, move |context| {
        create_zip_blocking(paths, destination, &context)
    }))
}

#[tauri::command]
pub fn enqueue_zip_extraction(app: AppHandle, path: String, destination: String) -> Result<u64, String> {
    let name = Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive.zip".to_string());
    Ok(queue::enqueue_blocking(app, "archive", format!("Extract ZIP · {name}"), move |context| {
        extract_zip_blocking(path, destination, &context)
    }))
}

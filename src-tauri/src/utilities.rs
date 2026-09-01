use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{self, BufReader, Read},
    path::{Path, PathBuf},
};
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksumResult {
    path: String,
    algorithm: String,
    digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRenamePreview {
    source: String,
    destination: String,
    current_name: String,
    next_name: String,
    valid: bool,
    error: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRenameOperation {
    source: String,
    destination: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOperationResult {
    path: String,
    entries: usize,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name cannot be empty".into());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain path separators".into());
    }
    if name == "." || name == ".." {
        return Err("Name cannot be . or ..".into());
    }
    Ok(())
}

fn template_name(path: &Path, template: &str, number: usize) -> Result<String, String> {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or_else(|| "Cannot rename this path".to_string())?;
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.clone());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();

    let rendered = template
        .replace("{name}", &name)
        .replace("{stem}", &stem)
        .replace("{ext}", &extension)
        .replace("{n}", &number.to_string());
    validate_name(&rendered)?;
    Ok(rendered)
}

#[tauri::command]
pub fn checksum_entries(paths: Vec<String>) -> Result<Vec<ChecksumResult>, String> {
    let mut results = Vec::with_capacity(paths.len());
    let mut buffer = vec![0u8; 1024 * 1024];

    for path in paths {
        let path_buf = PathBuf::from(&path);
        if !path_buf.is_file() {
            return Err(format!("Checksums currently require files: {}", path_buf.display()));
        }

        let file = File::open(&path_buf).map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(file);
        let mut hasher = Sha256::new();
        loop {
            let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }

        results.push(ChecksumResult {
            path,
            algorithm: "SHA-256".to_string(),
            digest: format!("{:x}", hasher.finalize()),
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn preview_batch_rename(
    paths: Vec<String>,
    template: String,
    start: usize,
) -> Result<Vec<BatchRenamePreview>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    if template.trim().is_empty() {
        return Err("Rename template cannot be empty".into());
    }

    let sources: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let mut seen_destinations = HashSet::new();
    let mut previews = Vec::with_capacity(paths.len());

    for (offset, raw_path) in paths.into_iter().enumerate() {
        let source = PathBuf::from(&raw_path);
        let current_name = source
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| raw_path.clone());
        let parent = source.parent().ok_or_else(|| "Cannot rename this path".to_string())?;

        let (next_name, destination, mut error) = match template_name(&source, &template, start + offset) {
            Ok(next_name) => {
                let destination = parent.join(&next_name);
                (next_name, destination, None)
            }
            Err(reason) => (current_name.clone(), source.clone(), Some(reason)),
        };

        if error.is_none() && !seen_destinations.insert(destination.clone()) {
            error = Some("Multiple items would receive the same name".into());
        }
        if error.is_none() && destination != source && destination.exists() && !sources.contains(&destination) {
            error = Some("An item with that name already exists".into());
        }

        previews.push(BatchRenamePreview {
            source: raw_path,
            destination: path_string(&destination),
            current_name,
            next_name,
            valid: error.is_none(),
            error,
        });
    }

    Ok(previews)
}

#[tauri::command]
pub fn apply_batch_rename(operations: Vec<BatchRenameOperation>) -> Result<(), String> {
    let operations: Vec<_> = operations
        .into_iter()
        .map(|operation| (PathBuf::from(operation.source), PathBuf::from(operation.destination)))
        .filter(|(source, destination)| source != destination)
        .collect();

    if operations.is_empty() {
        return Ok(());
    }

    let sources: HashSet<PathBuf> = operations.iter().map(|(source, _)| source.clone()).collect();
    let mut destinations = HashSet::new();
    for (source, destination) in &operations {
        if !source.exists() {
            return Err(format!("Source no longer exists: {}", source.display()));
        }
        if source.parent() != destination.parent() {
            return Err("Batch rename cannot move items between folders".into());
        }
        let name = destination
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .ok_or_else(|| "Invalid destination name".to_string())?;
        validate_name(&name)?;
        if !destinations.insert(destination.clone()) {
            return Err("Multiple items would receive the same name".into());
        }
        if destination.exists() && !sources.contains(destination) {
            return Err(format!("Destination already exists: {}", destination.display()));
        }
    }

    let mut staged = Vec::with_capacity(operations.len());
    for (index, (source, destination)) in operations.iter().enumerate() {
        let parent = source.parent().ok_or_else(|| "Cannot rename this path".to_string())?;
        let mut temp = parent.join(format!(".scout-rename-{}-{index}", std::process::id()));
        let mut attempt = 0usize;
        while temp.exists() {
            attempt += 1;
            temp = parent.join(format!(".scout-rename-{}-{index}-{attempt}", std::process::id()));
        }

        if let Err(error) = fs::rename(source, &temp) {
            for (original, staged_path, _) in staged.iter().rev() {
                let _ = fs::rename(staged_path, original);
            }
            return Err(format!("Could not stage rename for {}: {error}", source.display()));
        }
        staged.push((source.clone(), temp, destination.clone()));
    }

    let mut completed = 0usize;
    while completed < staged.len() {
        let (_, temp, destination) = &staged[completed];
        if let Err(error) = fs::rename(temp, destination) {
            for index in (0..completed).rev() {
                let (original, _, final_path) = &staged[index];
                let _ = fs::rename(final_path, original);
            }
            for (original, staged_path, _) in staged.iter().skip(completed) {
                let _ = fs::rename(staged_path, original);
            }
            return Err(format!("Could not finish batch rename: {error}"));
        }
        completed += 1;
    }

    Ok(())
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

fn add_path_to_zip(writer: &mut ZipWriter<File>, source: &Path) -> Result<usize, String> {
    let parent = source.parent().ok_or_else(|| "Cannot archive this path".to_string())?;
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut entries = 0usize;

    if source.is_file() {
        let name = zip_entry_name(source, parent)?;
        let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
        writer
            .start_file(name, options.large_file(metadata.len() > u32::MAX as u64))
            .map_err(|error| error.to_string())?;
        let mut file = File::open(source).map_err(|error| error.to_string())?;
        io::copy(&mut file, writer).map_err(|error| error.to_string())?;
        return Ok(1);
    }

    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if entry.file_type().is_symlink() {
            continue;
        }
        let mut name = zip_entry_name(path, parent)?;
        if entry.file_type().is_dir() {
            if !name.ends_with('/') {
                name.push('/');
            }
            writer.add_directory(name, options).map_err(|error| error.to_string())?;
        } else if entry.file_type().is_file() {
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            writer
                .start_file(name, options.large_file(metadata.len() > u32::MAX as u64))
                .map_err(|error| error.to_string())?;
            let mut file = File::open(path).map_err(|error| error.to_string())?;
            io::copy(&mut file, writer).map_err(|error| error.to_string())?;
        }
        entries += 1;
    }

    Ok(entries)
}

#[tauri::command]
pub fn create_zip_archive(paths: Vec<String>, destination: String) -> Result<ArchiveOperationResult, String> {
    if paths.is_empty() {
        return Err("Choose at least one item to archive".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Archive destination is not a directory".into());
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
    let mut entries = 0usize;

    for raw_path in paths {
        let source = PathBuf::from(raw_path);
        if !source.exists() {
            let _ = fs::remove_file(&output);
            return Err(format!("Item no longer exists: {}", source.display()));
        }
        match add_path_to_zip(&mut writer, &source) {
            Ok(count) => entries += count,
            Err(error) => {
                drop(writer);
                let _ = fs::remove_file(&output);
                return Err(error);
            }
        }
    }

    writer.finish().map_err(|error| error.to_string())?;
    Ok(ArchiveOperationResult { path: path_string(&output), entries })
}

#[tauri::command]
pub fn extract_zip_archive(path: String, destination: String) -> Result<ArchiveOperationResult, String> {
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

    let file = File::open(&archive_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("Could not read ZIP archive: {error}"))?;
    let mut extracted = 0usize;

    for index in 0..archive.len() {
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
            io::copy(&mut entry, &mut output_file).map_err(|error| error.to_string())?;
        }
        extracted += 1;
    }

    Ok(ArchiveOperationResult { path: path_string(&output), entries: extracted })
}

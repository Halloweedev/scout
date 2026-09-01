use serde::Serialize;
use std::{fs::File, path::PathBuf};
use zip::ZipArchive;

const ARCHIVE_PREVIEW_LIMIT: usize = 120;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveChild {
    name: String,
    kind: String,
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreview {
    name: String,
    path: String,
    total_entries: usize,
    truncated: bool,
    children: Vec<ArchiveChild>,
}

#[tauri::command]
pub fn preview_zip_archive(path: String) -> Result<ArchivePreview, String> {
    let path_buf = PathBuf::from(&path);
    let extension = path_buf
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase());
    if extension.as_deref() != Some("zip") {
        return Err("Only ZIP archives are supported by this preview command".to_string());
    }

    let file = File::open(&path_buf).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("Could not read ZIP archive: {error}"))?;
    let total_entries = archive.len();
    let mut children = Vec::with_capacity(total_entries.min(ARCHIVE_PREVIEW_LIMIT));

    for index in 0..total_entries.min(ARCHIVE_PREVIEW_LIMIT) {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read ZIP entry {index}: {error}"))?;
        children.push(ArchiveChild {
            name: entry.name().to_string(),
            kind: if entry.is_dir() { "directory" } else { "file" }.to_string(),
            size: (!entry.is_dir()).then_some(entry.size()),
        });
    }

    children.sort_by(|left, right| {
        let left_directory = left.kind == "directory";
        let right_directory = right.kind == "directory";
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(ArchivePreview {
        name: path_buf
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone()),
        path,
        total_entries,
        truncated: total_entries > ARCHIVE_PREVIEW_LIMIT,
        children,
    })
}

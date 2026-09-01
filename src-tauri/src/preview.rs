use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageFormat;
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{BufReader, Cursor, Read},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const TEXT_PREVIEW_LIMIT: u64 = 512 * 1024;
const DIRECTORY_PREVIEW_LIMIT: usize = 40;
const EXIF_PREVIEW_LIMIT: usize = 24;
const IMAGE_PREVIEW_WIDTH: u32 = 1400;
const IMAGE_PREVIEW_HEIGHT: u32 = 1000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMetadataItem {
    label: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewChild {
    name: String,
    kind: String,
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewData {
    kind: String,
    name: String,
    path: String,
    extension: Option<String>,
    size: Option<u64>,
    modified_ms: Option<u64>,
    text: Option<String>,
    truncated: bool,
    data_url: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    metadata: Vec<PreviewMetadataItem>,
    children: Vec<PreviewChild>,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_string(path))
}

fn base_preview(path: &Path, metadata: &fs::Metadata, kind: &str) -> PreviewData {
    PreviewData {
        kind: kind.to_string(),
        name: display_name(path),
        path: path_string(path),
        extension: extension(path),
        size: metadata.is_file().then_some(metadata.len()),
        modified_ms: modified_ms(metadata),
        text: None,
        truncated: false,
        data_url: None,
        width: None,
        height: None,
        metadata: Vec::new(),
        children: Vec::new(),
    }
}

fn is_image_extension(extension: Option<&str>) -> bool {
    matches!(
        extension,
        Some("jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "ico")
    )
}

fn is_markdown_extension(extension: Option<&str>) -> bool {
    matches!(extension, Some("md" | "markdown" | "mdown" | "mkd"))
}

fn is_text_extension(extension: Option<&str>) -> bool {
    matches!(
        extension,
        Some(
            "txt"
                | "text"
                | "log"
                | "csv"
                | "tsv"
                | "json"
                | "jsonc"
                | "toml"
                | "yaml"
                | "yml"
                | "xml"
                | "html"
                | "htm"
                | "css"
                | "scss"
                | "less"
                | "js"
                | "jsx"
                | "mjs"
                | "cjs"
                | "ts"
                | "tsx"
                | "rs"
                | "py"
                | "rb"
                | "go"
                | "java"
                | "kt"
                | "kts"
                | "swift"
                | "c"
                | "h"
                | "cc"
                | "cpp"
                | "cxx"
                | "hpp"
                | "cs"
                | "php"
                | "sh"
                | "bash"
                | "zsh"
                | "fish"
                | "ps1"
                | "sql"
                | "ini"
                | "cfg"
                | "conf"
                | "env"
                | "gitignore"
                | "dockerfile"
                | "makefile"
        )
    ) || is_markdown_extension(extension)
}

fn truncate_value(value: String, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value;
    }
    let mut result: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    result.push('…');
    result
}

fn read_exif(path: &Path) -> Vec<PreviewMetadataItem> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let mut reader = BufReader::new(file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) else {
        return Vec::new();
    };

    exif.fields()
        .take(EXIF_PREVIEW_LIMIT)
        .map(|field| PreviewMetadataItem {
            label: field.tag.to_string(),
            value: truncate_value(field.display_value().with_unit(&exif).to_string(), 140),
        })
        .collect()
}

fn preview_image(path: &Path, metadata: &fs::Metadata) -> Result<PreviewData, String> {
    let source = image::open(path).map_err(|error| format!("Could not decode image: {error}"))?;
    let width = source.width();
    let height = source.height();
    let rendered = source.thumbnail(IMAGE_PREVIEW_WIDTH, IMAGE_PREVIEW_HEIGHT);
    let mut buffer = Cursor::new(Vec::new());
    rendered
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|error| format!("Could not encode image preview: {error}"))?;

    let mut preview = base_preview(path, metadata, "image");
    preview.data_url = Some(format!("data:image/png;base64,{}", STANDARD.encode(buffer.into_inner())));
    preview.width = Some(width);
    preview.height = Some(height);
    preview.metadata = read_exif(path);
    Ok(preview)
}

fn preview_text(path: &Path, metadata: &fs::Metadata, markdown: bool) -> Result<PreviewData, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(TEXT_PREVIEW_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;

    let truncated = bytes.len() as u64 > TEXT_PREVIEW_LIMIT;
    if truncated {
        bytes.truncate(TEXT_PREVIEW_LIMIT as usize);
    }
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Ok(base_preview(path, metadata, "unsupported"));
    }

    let mut preview = base_preview(path, metadata, if markdown { "markdown" } else { "text" });
    preview.text = Some(String::from_utf8_lossy(&bytes).into_owned());
    preview.truncated = truncated;
    Ok(preview)
}

fn preview_directory(path: &Path, metadata: &fs::Metadata) -> Result<PreviewData, String> {
    let mut children = Vec::new();
    for child in fs::read_dir(path).map_err(|error| error.to_string())? {
        let Ok(child) = child else { continue };
        let child_path = child.path();
        let Ok(child_metadata) = fs::symlink_metadata(&child_path) else { continue };
        let kind = if child_metadata.is_dir() {
            "directory"
        } else if child_metadata.is_file() {
            "file"
        } else if child_metadata.file_type().is_symlink() {
            "symlink"
        } else {
            "other"
        };
        children.push(PreviewChild {
            name: child.file_name().to_string_lossy().into_owned(),
            kind: kind.to_string(),
            size: child_metadata.is_file().then_some(child_metadata.len()),
        });
    }

    children.sort_by(|left, right| {
        let left_directory = left.kind == "directory";
        let right_directory = right.kind == "directory";
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let truncated = children.len() > DIRECTORY_PREVIEW_LIMIT;
    children.truncate(DIRECTORY_PREVIEW_LIMIT);

    let mut preview = base_preview(path, metadata, "directory");
    preview.children = children;
    preview.truncated = truncated;
    Ok(preview)
}

#[tauri::command]
pub fn preview_entry(path: String) -> Result<PreviewData, String> {
    let path = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;

    if metadata.is_dir() {
        return preview_directory(&path, &metadata);
    }

    if !metadata.is_file() {
        return Ok(base_preview(&path, &metadata, "unsupported"));
    }

    let extension = extension(&path);
    if is_image_extension(extension.as_deref()) {
        return preview_image(&path, &metadata);
    }
    if is_text_extension(extension.as_deref()) {
        return preview_text(&path, &metadata, is_markdown_extension(extension.as_deref()));
    }

    Ok(base_preview(&path, &metadata, "unsupported"))
}

use crate::queue::{self, JobContext};
use image::imageops::FilterType;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use walkdir::WalkDir;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico"];

#[derive(Clone)]
struct HashedPhoto {
    path: String,
    name: String,
    hash: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPhotoItem {
    path: String,
    name: String,
    distance: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPhotoGroup {
    representative: String,
    files: Vec<SimilarPhotoItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPhotoScan {
    root: String,
    scanned: usize,
    truncated: bool,
    groups: Vec<SimilarPhotoGroup>,
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .map(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

fn difference_hash(path: &Path, context: Option<&JobContext>) -> Result<u64, String> {
    if context.is_some_and(JobContext::cancelled) {
        return Err("Similar photo scan cancelled".into());
    }
    let image = image::open(path).map_err(|error| error.to_string())?;
    if context.is_some_and(JobContext::cancelled) {
        return Err("Similar photo scan cancelled".into());
    }
    let gray = image.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut hash = 0u64;
    let mut bit = 0u32;
    for y in 0..8 {
        for x in 0..8 {
            if gray.get_pixel(x, y)[0] > gray.get_pixel(x + 1, y)[0] {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    Ok(hash)
}

fn hamming(left: u64, right: u64) -> u32 {
    (left ^ right).count_ones()
}

fn scan(
    root: PathBuf,
    threshold: u32,
    max_files: usize,
    context: Option<&JobContext>,
) -> Result<SimilarPhotoScan, String> {
    if !root.is_dir() {
        return Err("Similar photo root is not a directory".into());
    }
    let threshold = threshold.min(16);
    let max_files = max_files.clamp(1, 5_000);
    let mut photos = Vec::new();
    let mut truncated = false;

    for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_map(Result::ok) {
        if context.is_some_and(JobContext::cancelled) {
            return Err("Similar photo scan cancelled".into());
        }
        if entry.file_type().is_symlink() || !entry.file_type().is_file() || !is_image(entry.path()) {
            continue;
        }
        if photos.len() >= max_files {
            truncated = true;
            break;
        }
        let Ok(hash) = difference_hash(entry.path(), context) else {
            if context.is_some_and(JobContext::cancelled) {
                return Err("Similar photo scan cancelled".into());
            }
            continue;
        };
        photos.push(HashedPhoto {
            path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            hash,
        });
        if photos.len() % 20 == 0 {
            if let Some(context) = context {
                let progress = (photos.len() as f64 / max_files as f64 * 0.75).min(0.75);
                context.progress(
                    Some(progress),
                    Some(format!("Hashed {} images", photos.len())),
                );
            }
        }
    }

    photos.sort_by(|left, right| left.path.cmp(&right.path));
    let scanned = photos.len();
    let mut clusters: Vec<(u64, String, Vec<SimilarPhotoItem>)> = Vec::new();

    for (index, photo) in photos.into_iter().enumerate() {
        if context.is_some_and(JobContext::cancelled) {
            return Err("Similar photo scan cancelled".into());
        }
        let mut matched = false;
        for (representative_hash, _, files) in &mut clusters {
            if context.is_some_and(JobContext::cancelled) {
                return Err("Similar photo scan cancelled".into());
            }
            let distance = hamming(*representative_hash, photo.hash);
            if distance <= threshold {
                files.push(SimilarPhotoItem {
                    path: photo.path.clone(),
                    name: photo.name.clone(),
                    distance,
                });
                matched = true;
                break;
            }
        }
        if !matched {
            clusters.push((
                photo.hash,
                photo.path.clone(),
                vec![SimilarPhotoItem {
                    path: photo.path,
                    name: photo.name,
                    distance: 0,
                }],
            ));
        }
        if let Some(context) = context {
            let denominator = scanned.max(1) as f64;
            let progress = 0.75 + 0.25 * ((index + 1) as f64 / denominator);
            if index % 20 == 0 || index + 1 == scanned {
                context.progress(
                    Some(progress),
                    Some(format!("Comparing {} of {scanned} images", index + 1)),
                );
            }
        }
    }

    let mut groups: Vec<_> = clusters
        .into_iter()
        .filter(|(_, _, files)| files.len() > 1)
        .map(|(_, representative, mut files)| {
            files.sort_by_key(|item| item.distance);
            SimilarPhotoGroup { representative, files }
        })
        .collect();
    groups.sort_by(|left, right| right.files.len().cmp(&left.files.len()));

    if let Some(context) = context {
        context.progress(Some(1.0), Some("Similar photo scan complete".to_string()));
    }

    Ok(SimilarPhotoScan {
        root: root.to_string_lossy().into_owned(),
        scanned,
        truncated,
        groups,
    })
}

#[tauri::command]
pub async fn find_similar_photos(
    root: String,
    threshold: u32,
    max_files: usize,
) -> Result<SimilarPhotoScan, String> {
    tauri::async_runtime::spawn_blocking(move || scan(PathBuf::from(root), threshold, max_files, None))
        .await
        .map_err(|error| format!("Similar photo scan task failed: {error}"))?
}

#[tauri::command]
pub fn enqueue_similar_photo_scan(
    app: AppHandle,
    root: String,
    threshold: u32,
    max_files: usize,
) -> Result<u64, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Similar photo root is not a directory".into());
    }
    let label = format!(
        "Find similar photos · {}",
        root_path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.clone())
    );
    Ok(queue::enqueue_blocking(app, "similar-photos", label, move |context| {
        scan(root_path, threshold, max_files, Some(&context))
    }))
}

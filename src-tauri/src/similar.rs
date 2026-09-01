use image::imageops::FilterType;
use serde::Serialize;
use std::path::{Path, PathBuf};
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

fn difference_hash(path: &Path) -> Result<u64, String> {
    let image = image::open(path).map_err(|error| error.to_string())?;
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

fn scan(root: PathBuf, threshold: u32, max_files: usize) -> Result<SimilarPhotoScan, String> {
    if !root.is_dir() {
        return Err("Similar photo root is not a directory".into());
    }
    let threshold = threshold.min(16);
    let max_files = max_files.clamp(1, 5_000);
    let mut photos = Vec::new();
    let mut truncated = false;

    for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_symlink() || !entry.file_type().is_file() || !is_image(entry.path()) {
            continue;
        }
        if photos.len() >= max_files {
            truncated = true;
            break;
        }
        let Ok(hash) = difference_hash(entry.path()) else {
            continue;
        };
        photos.push(HashedPhoto {
            path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            hash,
        });
    }

    photos.sort_by(|left, right| left.path.cmp(&right.path));
    let scanned = photos.len();
    let mut clusters: Vec<(u64, String, Vec<SimilarPhotoItem>)> = Vec::new();

    for photo in photos {
        let mut matched = false;
        for (representative_hash, _, files) in &mut clusters {
            let distance = hamming(*representative_hash, photo.hash);
            if distance <= threshold {
                files.push(SimilarPhotoItem { path: photo.path.clone(), name: photo.name.clone(), distance });
                matched = true;
                break;
            }
        }
        if !matched {
            clusters.push((
                photo.hash,
                photo.path.clone(),
                vec![SimilarPhotoItem { path: photo.path, name: photo.name, distance: 0 }],
            ));
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
    tauri::async_runtime::spawn_blocking(move || scan(PathBuf::from(root), threshold, max_files))
        .await
        .map_err(|error| format!("Similar photo scan task failed: {error}"))?
}

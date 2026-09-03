use crate::queue::{self, JobContext};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use walkdir::WalkDir;

const PREHASH_CHUNK: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    size: u64,
    digest: String,
    wasted_bytes: u64,
    paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateScan {
    root: String,
    scanned_files: usize,
    duplicate_files: usize,
    duplicate_bytes: u64,
    groups: Vec<DuplicateGroup>,
}

fn cancelled(context: Option<&JobContext>) -> bool {
    context.is_some_and(JobContext::cancelled)
}

fn full_hash(path: &Path, context: Option<&JobContext>) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        if cancelled(context) {
            return Err("Duplicate scan cancelled".into());
        }
        let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn prehash_file(path: &Path, size: u64, context: Option<&JobContext>) -> Result<String, String> {
    if cancelled(context) {
        return Err("Duplicate scan cancelled".into());
    }
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());

    let first_len = usize::try_from(size.min(PREHASH_CHUNK as u64)).unwrap_or(PREHASH_CHUNK);
    let mut first = vec![0u8; first_len];
    if first_len > 0 {
        file.read_exact(&mut first).map_err(|error| error.to_string())?;
        hasher.update(&first);
    }

    if size > PREHASH_CHUNK as u64 {
        if cancelled(context) {
            return Err("Duplicate scan cancelled".into());
        }
        let tail_len = usize::try_from(size.min(PREHASH_CHUNK as u64)).unwrap_or(PREHASH_CHUNK);
        file.seek(SeekFrom::End(-(tail_len as i64))).map_err(|error| error.to_string())?;
        let mut tail = vec![0u8; tail_len];
        file.read_exact(&mut tail).map_err(|error| error.to_string())?;
        hasher.update(&tail);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn scan(root: PathBuf, min_size: u64, context: Option<&JobContext>) -> Result<DuplicateScan, String> {
    if !root.is_dir() {
        return Err("Duplicate scan root is not a directory".into());
    }

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut scanned_files = 0usize;

    for entry in WalkDir::new(&root).follow_links(false) {
        if cancelled(context) {
            return Err("Duplicate scan cancelled".into());
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        scanned_files += 1;
        if scanned_files % 250 == 0 {
            if let Some(context) = context {
                context.progress(None, Some(format!("Scanned {scanned_files} files")));
            }
        }
        if metadata.len() < min_size {
            continue;
        }
        by_size.entry(metadata.len()).or_default().push(entry.into_path());
    }

    let prehash_total: usize = by_size
        .values()
        .filter(|paths| paths.len() > 1)
        .map(Vec::len)
        .sum();
    let mut prehashed = 0usize;
    let mut full_groups: Vec<(u64, Vec<PathBuf>)> = Vec::new();

    for (size, candidates) in by_size.into_iter().filter(|(_, paths)| paths.len() > 1) {
        let mut by_prehash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in candidates {
            if cancelled(context) {
                return Err("Duplicate scan cancelled".into());
            }
            match prehash_file(&path, size, context) {
                Ok(digest) => by_prehash.entry(digest).or_default().push(path),
                Err(error) if cancelled(context) => return Err(error),
                Err(_) => {}
            }
            prehashed += 1;
            if let Some(context) = context {
                let progress = if prehash_total == 0 {
                    0.5
                } else {
                    0.2 + 0.3 * (prehashed as f64 / prehash_total as f64)
                };
                context.progress(
                    Some(progress),
                    Some(format!("Fingerprinting {prehashed} of {prehash_total} candidates")),
                );
            }
        }
        for paths in by_prehash.into_values().filter(|paths| paths.len() > 1) {
            full_groups.push((size, paths));
        }
    }

    let full_total: usize = full_groups.iter().map(|(_, paths)| paths.len()).sum();
    let mut hashed = 0usize;
    let mut groups = Vec::new();
    for (size, candidates) in full_groups {
        let mut by_hash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in candidates {
            if cancelled(context) {
                return Err("Duplicate scan cancelled".into());
            }
            let digest = match full_hash(&path, context) {
                Ok(digest) => digest,
                Err(error) if cancelled(context) => return Err(error),
                Err(_) => {
                    hashed += 1;
                    continue;
                }
            };
            hashed += 1;
            if let Some(context) = context {
                let progress = if full_total == 0 {
                    1.0
                } else {
                    0.5 + 0.5 * (hashed as f64 / full_total as f64)
                };
                context.progress(
                    Some(progress),
                    Some(format!("Verifying {hashed} of {full_total} likely duplicates")),
                );
            }
            by_hash.entry(digest).or_default().push(path);
        }

        for (digest, paths) in by_hash.into_iter().filter(|(_, paths)| paths.len() > 1) {
            let wasted_bytes = size.saturating_mul(paths.len().saturating_sub(1) as u64);
            groups.push(DuplicateGroup {
                size,
                digest,
                wasted_bytes,
                paths: paths
                    .into_iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
            });
        }
    }

    groups.sort_by(|left, right| right.wasted_bytes.cmp(&left.wasted_bytes));
    let duplicate_files = groups.iter().map(|group| group.paths.len()).sum();
    let duplicate_bytes = groups.iter().map(|group| group.wasted_bytes).sum();
    if let Some(context) = context {
        context.progress(Some(1.0), Some("Duplicate scan complete".to_string()));
    }

    Ok(DuplicateScan {
        root: root.to_string_lossy().into_owned(),
        scanned_files,
        duplicate_files,
        duplicate_bytes,
        groups,
    })
}

#[tauri::command]
pub async fn find_duplicate_files(root: String, min_size: u64) -> Result<DuplicateScan, String> {
    tauri::async_runtime::spawn_blocking(move || scan(PathBuf::from(root), min_size, None))
        .await
        .map_err(|error| format!("Duplicate scan task failed: {error}"))?
}

#[tauri::command]
pub fn enqueue_duplicate_scan(app: AppHandle, root: String, min_size: u64) -> Result<u64, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Duplicate scan root is not a directory".into());
    }
    let label = format!(
        "Find duplicates · {}",
        root_path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.clone())
    );
    Ok(queue::enqueue_blocking(app, "duplicates", label, move |context| {
        scan(root_path, min_size, Some(&context))
    }))
}

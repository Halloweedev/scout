use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

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

fn hash_file(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn scan(root: PathBuf, min_size: u64) -> Result<DuplicateScan, String> {
    if !root.is_dir() {
        return Err("Duplicate scan root is not a directory".into());
    }

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut scanned_files = 0usize;

    for entry in WalkDir::new(&root).follow_links(false) {
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
        if metadata.len() < min_size {
            continue;
        }
        by_size.entry(metadata.len()).or_default().push(entry.into_path());
    }

    let mut groups = Vec::new();
    for (size, candidates) in by_size.into_iter().filter(|(_, paths)| paths.len() > 1) {
        let mut by_hash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in candidates {
            let digest = match hash_file(&path) {
                Ok(digest) => digest,
                Err(_) => continue,
            };
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
    tauri::async_runtime::spawn_blocking(move || scan(PathBuf::from(root), min_size))
        .await
        .map_err(|error| format!("Duplicate scan task failed: {error}"))?
}

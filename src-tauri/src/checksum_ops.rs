use crate::queue;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
};
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksumResult {
    path: String,
    algorithm: String,
    digest: String,
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 { format!("{bytes} {}", UNITS[unit]) } else { format!("{value:.1} {}", UNITS[unit]) }
}

#[tauri::command]
pub fn enqueue_checksum_entries(app: AppHandle, paths: Vec<String>) -> Result<u64, String> {
    if paths.is_empty() {
        return Err("Choose at least one file".into());
    }
    let total_files = paths.len();
    let label = if total_files == 1 {
        let name = Path::new(&paths[0]).file_name().map(|value| value.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
        format!("SHA-256 · {name}")
    } else {
        format!("SHA-256 · {total_files} files")
    };

    Ok(queue::enqueue_blocking(app, "checksum", label, move |context| {
        let mut total_bytes = 0u64;
        for raw in &paths {
            let path = PathBuf::from(raw);
            if !path.is_file() {
                return Err(format!("Checksums require files: {}", path.display()));
            }
            total_bytes = total_bytes.saturating_add(fs::metadata(&path).map_err(|error| error.to_string())?.len());
        }

        let mut processed = 0u64;
        let mut results = Vec::with_capacity(total_files);
        let mut buffer = vec![0u8; 1024 * 1024];
        for (index, raw) in paths.into_iter().enumerate() {
            if context.cancelled() {
                return Err("Checksum calculation cancelled".into());
            }
            let path = PathBuf::from(&raw);
            let file = File::open(&path).map_err(|error| error.to_string())?;
            let mut reader = BufReader::new(file);
            let mut hasher = Sha256::new();
            loop {
                if context.cancelled() {
                    return Err("Checksum calculation cancelled".into());
                }
                let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
                if read == 0 { break; }
                hasher.update(&buffer[..read]);
                processed = processed.saturating_add(read as u64);
                let progress = (total_bytes > 0).then_some((processed as f64 / total_bytes as f64).clamp(0.0, 1.0));
                context.progress(progress, Some(format!("Hashing {}/{} · {}", index + 1, total_files, format_bytes(processed))));
            }
            results.push(ChecksumResult {
                path: raw,
                algorithm: "SHA-256".to_string(),
                digest: format!("{:x}", hasher.finalize()),
            });
        }
        context.progress(Some(1.0), Some(format!("Hashed {} files · {}", results.len(), format_bytes(processed))));
        Ok(results)
    }))
}

from pathlib import Path

path = Path("src-tauri/src/fs.rs")
text = path.read_text()
old = '''#[tauri::command]
pub fn special_directories() -> Result<SpecialDirectories, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve the home directory".to_string())?;
    let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    let icloud_path = icloud.is_dir().then(|| path_string(&icloud));
    let trash = home.join(".Trash");
    let trash_path = trash.is_dir().then(|| path_string(&trash));
    let drives = std::fs::read_dir("/Volumes")
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let p = e.path();
                    // filter out hidden and non-directory, keep actual volumes
                    if p.is_dir() {
                        Some(path_string(&p))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SpecialDirectories {
        home: path_string(&home),
        desktop: dirs::desktop_dir().map(|path| path_string(&path)),
        documents: dirs::document_dir().map(|path| path_string(&path)),
        downloads: dirs::download_dir().map(|path| path_string(&path)),
        pictures: dirs::picture_dir().map(|path| path_string(&path)),
        music: dirs::audio_dir().map(|path| path_string(&path)),
        movies: dirs::video_dir().map(|path| path_string(&path)),
        trash: trash_path,
        icloud: icloud_path,
        drives,
        network: Some("/Network".to_string()),
        applications: Some("/Applications".to_string()),
    })
}
'''
new = '''fn push_directory_if_present(paths: &mut Vec<String>, path: PathBuf) {
    if !path.is_dir() {
        return;
    }
    let value = path_string(&path);
    if !paths.iter().any(|existing| existing == &value) {
        paths.push(value);
    }
}

#[cfg(target_os = "macos")]
fn platform_locations(home: &Path) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>) {
    let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    let trash = home.join(".Trash");
    let mut drives = Vec::new();
    if let Ok(entries) = fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            push_directory_if_present(&mut drives, entry.path());
        }
    }
    (
        icloud.is_dir().then(|| path_string(&icloud)),
        trash.is_dir().then(|| path_string(&trash)),
        drives,
        Path::new("/Network").is_dir().then(|| "/Network".to_string()),
        Path::new("/Applications").is_dir().then(|| "/Applications".to_string()),
    )
}

#[cfg(target_os = "windows")]
fn platform_locations(_home: &Path) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>) {
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\\\", letter as char));
        push_directory_if_present(&mut drives, root);
    }
    // The Windows Recycle Bin and network namespace are shell objects, not normal
    // directories Scout can safely enumerate through std::fs.
    (None, None, drives, None, None)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_locations(home: &Path) -> (Option<String>, Option<String>, Vec<String>, Option<String>, Option<String>) {
    let trash = home.join(".local/share/Trash/files");
    let mut drives = Vec::new();
    for root in [PathBuf::from("/media"), PathBuf::from("/mnt")] {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                push_directory_if_present(&mut drives, entry.path());
            }
        }
    }
    if let Ok(user) = std::env::var("USER") {
        let run_media = PathBuf::from("/run/media").join(user);
        if let Ok(entries) = fs::read_dir(run_media) {
            for entry in entries.flatten() {
                push_directory_if_present(&mut drives, entry.path());
            }
        }
    }
    (None, trash.is_dir().then(|| path_string(&trash)), drives, None, None)
}

#[tauri::command]
pub fn special_directories() -> Result<SpecialDirectories, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve the home directory".to_string())?;
    let (icloud, trash, drives, network, applications) = platform_locations(&home);

    Ok(SpecialDirectories {
        home: path_string(&home),
        desktop: dirs::desktop_dir().map(|path| path_string(&path)),
        documents: dirs::document_dir().map(|path| path_string(&path)),
        downloads: dirs::download_dir().map(|path| path_string(&path)),
        pictures: dirs::picture_dir().map(|path| path_string(&path)),
        music: dirs::audio_dir().map(|path| path_string(&path)),
        movies: dirs::video_dir().map(|path| path_string(&path)),
        trash,
        icloud,
        drives,
        network,
        applications,
    })
}
'''
if text.count(old) != 1:
    raise SystemExit(f"special_directories block: expected 1 match, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("Applied cross-platform special directory fix")

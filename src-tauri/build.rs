#[cfg(target_os = "windows")]
use std::{fs, path::Path};

#[cfg(target_os = "windows")]
fn ensure_windows_icon() {
    let png_path = Path::new("icons/icon.png");
    let ico_path = Path::new("icons/icon.ico");
    let png = fs::read(png_path).expect("Scout icon.png is required to build the Windows icon");

    assert!(
        png.len() >= 24 && &png[..8] == b"\x89PNG\r\n\x1a\n" && &png[12..16] == b"IHDR",
        "Scout icon.png must be a valid PNG"
    );

    let width = u32::from_be_bytes(png[16..20].try_into().expect("PNG width"));
    let height = u32::from_be_bytes(png[20..24].try_into().expect("PNG height"));
    let icon_width = if width >= 256 { 0 } else { width as u8 };
    let icon_height = if height >= 256 { 0 } else { height as u8 };

    let mut ico = Vec::with_capacity(22 + png.len());
    ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    ico.extend_from_slice(&[icon_width, icon_height, 0, 0, 1, 0, 32, 0]);
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(&png);

    fs::write(ico_path, ico).expect("Scout could not generate icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
}

fn main() {
    #[cfg(target_os = "windows")]
    ensure_windows_icon();

    tauri_build::build()
}

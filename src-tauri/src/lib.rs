mod fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fs::special_directories,
            fs::list_directory,
            fs::rename_entry,
            fs::duplicate_entries,
            fs::copy_entries,
            fs::move_entries,
            fs::trash_entries,
            fs::create_folder,
            fs::open_entry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scout");
}

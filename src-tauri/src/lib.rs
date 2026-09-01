mod archive;
mod fs;
mod preview;
mod search;
mod utilities;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(watch::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            archive::preview_zip_archive,
            fs::special_directories,
            fs::list_directory,
            fs::rename_entry,
            fs::duplicate_entries,
            fs::copy_entries,
            fs::move_entries,
            fs::trash_entries,
            fs::create_folder,
            fs::open_entry,
            preview::preview_entry,
            preview::thumbnail_entry,
            search::index_status,
            search::rebuild_index,
            search::search_index,
            search::record_index_open,
            utilities::checksum_entries,
            utilities::preview_batch_rename,
            utilities::apply_batch_rename,
            utilities::create_zip_archive,
            utilities::extract_zip_archive,
            watch::watch_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scout");
}
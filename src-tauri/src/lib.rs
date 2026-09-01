mod archive;
mod converters;
mod disk;
mod duplicates;
mod fs;
mod images;
mod preview;
mod search;
mod similar;
mod utilities;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(watch::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            archive::preview_zip_archive,
            converters::converter_capabilities,
            converters::convert_media,
            converters::convert_with_pandoc,
            converters::convert_with_libreoffice,
            disk::analyze_folder_sizes,
            duplicates::find_duplicate_files,
            fs::special_directories,
            fs::list_directory,
            fs::rename_entry,
            fs::duplicate_entries,
            fs::copy_entries,
            fs::move_entries,
            fs::trash_entries,
            fs::create_folder,
            fs::open_entry,
            images::transform_images,
            preview::preview_entry,
            preview::thumbnail_entry,
            search::index_status,
            search::rebuild_index,
            search::search_index,
            search::record_index_open,
            similar::find_similar_photos,
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

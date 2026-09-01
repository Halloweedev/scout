mod archive;
mod converters;
mod disk;
mod duplicates;
mod fs;
mod history;
mod images;
mod pdf;
mod preview;
mod queue;
mod search;
mod similar;
mod terminal;
mod utilities;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(watch::WatchState::default())
        .manage(history::HistoryState::default())
        .manage(queue::OperationQueueState::default())
        .invoke_handler(tauri::generate_handler![
            archive::preview_zip_archive,
            converters::converter_capabilities,
            converters::convert_media,
            converters::convert_with_pandoc,
            converters::convert_with_libreoffice,
            disk::analyze_folder_sizes,
            disk::enqueue_folder_size_scan,
            duplicates::find_duplicate_files,
            duplicates::enqueue_duplicate_scan,
            fs::special_directories,
            fs::list_directory,
            fs::rename_entry,
            fs::duplicate_entries,
            fs::copy_entries,
            fs::move_entries,
            fs::trash_entries,
            fs::create_folder,
            fs::open_entry,
            fs::undo_last_operation,
            fs::redo_last_operation,
            history::operation_history,
            images::transform_images,
            pdf::pdf_info,
            pdf::extract_pdf_pages,
            pdf::split_pdf_pages,
            pdf::delete_pdf_pages,
            pdf::reorder_pdf_pages,
            pdf::rotate_pdf_pages,
            pdf::compress_pdf,
            pdf::strip_pdf_metadata,
            pdf::merge_pdfs,
            preview::preview_entry,
            preview::thumbnail_entry,
            queue::operation_queue,
            queue::cancel_operation,
            queue::clear_finished_operations,
            search::index_status,
            search::rebuild_index,
            search::search_index,
            search::record_index_open,
            similar::find_similar_photos,
            terminal::open_terminal,
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

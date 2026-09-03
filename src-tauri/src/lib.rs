mod archive;
mod archive_ops;
mod automation;
mod checksum_ops;
mod converters;
mod directory;
mod disk;
mod duplicates;
mod file_health;
mod fs;
mod history;
mod images;
mod pdf;
mod pdf_ops;
mod preview;
mod qol;
mod queue;
mod scripts;
mod search;
mod search_v2;
mod similar;
mod tag_collections;
mod tags;
mod terminal;
mod utilities;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(watch::WatchState::default())
        .manage(history::HistoryState::default())
        .manage(queue::OperationQueueState::default())
        .manage(automation::AutomationState::default())
        .manage(automation::AutomationWatchState::default())
        .invoke_handler(tauri::generate_handler![
            archive::preview_zip_archive,
            archive_ops::enqueue_zip_creation,
            archive_ops::enqueue_zip_extraction,
            automation::automation_rules,
            automation::save_automation_rule,
            automation::delete_automation_rule,
            automation::set_automation_rule_enabled,
            automation::preview_automation_rule,
            automation::enqueue_automation_rule,
            automation::enqueue_automation_trigger,
            automation::sync_automation_watches,
            checksum_ops::enqueue_checksum_entries,
            converters::converter_capabilities,
            converters::convert_media,
            converters::convert_with_pandoc,
            converters::convert_with_libreoffice,
            converters::enqueue_media_conversion,
            converters::enqueue_pandoc_conversion,
            converters::enqueue_libreoffice_conversion,
            directory::list_directory_fast,
            directory::list_directory_full,
            disk::analyze_folder_sizes,
            disk::enqueue_folder_size_scan,
            duplicates::find_duplicate_files,
            duplicates::enqueue_duplicate_scan,
            file_health::scan_file_health,
            file_health::enqueue_file_health_scan,
            fs::special_directories,
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
            images::enqueue_image_transform,
            pdf::pdf_info,
            pdf::extract_pdf_pages,
            pdf::split_pdf_pages,
            pdf::delete_pdf_pages,
            pdf::reorder_pdf_pages,
            pdf::rotate_pdf_pages,
            pdf::compress_pdf,
            pdf::strip_pdf_metadata,
            pdf::merge_pdfs,
            pdf_ops::enqueue_pdf_operation,
            preview::preview_entry,
            preview::thumbnail_entry,
            qol::delete_entries_permanently,
            qol::create_symlinks,
            qol::symlink_target,
            qol::open_in_ide,
            queue::operation_queue,
            queue::cancel_operation,
            queue::clear_finished_operations,
            search::index_status,
            search::rebuild_index,
            search::enqueue_index_rebuild,
            search::search_index,
            search::record_index_open,
            search_v2::search_index_v2,
            search_v2::deep_search,
            similar::find_similar_photos,
            similar::enqueue_similar_photo_scan,
            tag_collections::tag_collections,
            tag_collections::paths_for_tag,
            tags::tags_for_paths,
            tags::add_tags,
            tags::remove_tags,
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

use crate::{pdf, queue};
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfQueuedRequest {
    operation: String,
    path: Option<String>,
    paths: Option<Vec<String>>,
    pages: Option<Vec<u32>>,
    angle: Option<i64>,
    destination: String,
}

fn require<T>(value: Option<T>, name: &str) -> Result<T, String> {
    value.ok_or_else(|| format!("Missing PDF operation field: {name}"))
}

#[tauri::command]
pub fn enqueue_pdf_operation(app: AppHandle, request: PdfQueuedRequest) -> Result<u64, String> {
    let operation = request.operation.trim().to_string();
    let label = match operation.as_str() {
        "extract_pdf_pages" => "PDF · Extract pages",
        "split_pdf_pages" => "PDF · Split pages",
        "delete_pdf_pages" => "PDF · Delete pages",
        "reorder_pdf_pages" => "PDF · Reorder pages",
        "rotate_pdf_pages" => "PDF · Rotate pages",
        "compress_pdf" => "PDF · Compress",
        "strip_pdf_metadata" => "PDF · Remove metadata",
        "merge_pdfs" => "PDF · Merge",
        _ => return Err("Unknown PDF operation".into()),
    }
    .to_string();

    Ok(queue::enqueue_blocking(app, "pdf", label, move |context| {
        if context.cancelled() {
            return Err("PDF operation cancelled".into());
        }
        context.progress(None, Some("Processing PDF…".to_string()));
        let result = match operation.as_str() {
            "extract_pdf_pages" => pdf::extract_pdf_pages(
                require(request.path, "path")?,
                require(request.pages, "pages")?,
                request.destination,
            ),
            "split_pdf_pages" => pdf::split_pdf_pages(
                require(request.path, "path")?,
                require(request.pages, "pages")?,
                request.destination,
            ),
            "delete_pdf_pages" => pdf::delete_pdf_pages(
                require(request.path, "path")?,
                require(request.pages, "pages")?,
                request.destination,
            ),
            "reorder_pdf_pages" => pdf::reorder_pdf_pages(
                require(request.path, "path")?,
                require(request.pages, "pages")?,
                request.destination,
            ),
            "rotate_pdf_pages" => pdf::rotate_pdf_pages(
                require(request.path, "path")?,
                require(request.pages, "pages")?,
                require(request.angle, "angle")?,
                request.destination,
            ),
            "compress_pdf" => pdf::compress_pdf(require(request.path, "path")?, request.destination),
            "strip_pdf_metadata" => pdf::strip_pdf_metadata(require(request.path, "path")?, request.destination),
            "merge_pdfs" => pdf::merge_pdfs(require(request.paths, "paths")?, request.destination),
            _ => unreachable!(),
        }?;

        if context.cancelled() {
            return Err("PDF operation cancelled".into());
        }
        context.progress(Some(1.0), Some("PDF operation complete".to_string()));
        Ok(result)
    }))
}

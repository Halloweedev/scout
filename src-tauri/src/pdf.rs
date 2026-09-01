use lopdf::{dictionary, Document, Object, ObjectId};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadataEntry {
    key: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    path: String,
    pages: usize,
    encrypted: bool,
    metadata: Vec<PdfMetadataEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOperationResult {
    paths: Vec<String>,
    pages: usize,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn require_pdf(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("PDF does not exist: {}", path.display()));
    }
    if !path
        .extension()
        .map(|value| value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
    {
        return Err(format!("Not a PDF: {}", path.display()));
    }
    Ok(())
}

fn unique_output(directory: &Path, base: &str) -> PathBuf {
    let candidate = directory.join(format!("{base}.pdf"));
    if !candidate.exists() {
        return candidate;
    }
    for index in 2..10_000 {
        let candidate = directory.join(format!("{base} {index}.pdf"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{base} copy.pdf"))
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Document".to_string())
}

fn load_pdf(path: &Path) -> Result<Document, String> {
    require_pdf(path)?;
    Document::load(path).map_err(|error| format!("Could not open PDF: {error}"))
}

fn object_text(object: &Object) -> String {
    match object {
        Object::String(bytes, _) => String::from_utf8_lossy(bytes).into_owned(),
        Object::Name(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        Object::Integer(value) => value.to_string(),
        Object::Real(value) => value.to_string(),
        Object::Boolean(value) => value.to_string(),
        Object::Null => "null".to_string(),
        Object::Reference((id, generation)) => format!("{id} {generation} R"),
        _ => format!("{object:?}"),
    }
}

fn metadata_entries(doc: &Document) -> Vec<PdfMetadataEntry> {
    let Ok(info) = doc.trailer.get(b"Info") else {
        return Vec::new();
    };
    let dictionary = match info {
        Object::Reference(id) => doc.get_object(*id).and_then(Object::as_dict),
        Object::Dictionary(dictionary) => Ok(dictionary),
        _ => return Vec::new(),
    };
    let Ok(dictionary) = dictionary else {
        return Vec::new();
    };
    dictionary
        .iter()
        .map(|(key, value)| PdfMetadataEntry {
            key: String::from_utf8_lossy(key).into_owned(),
            value: object_text(value),
        })
        .collect()
}

fn validate_page_list(pages: &[u32], total: usize, allow_empty: bool) -> Result<(), String> {
    if pages.is_empty() && !allow_empty {
        return Err("Choose at least one page".into());
    }
    let mut seen = HashSet::new();
    for page in pages {
        if *page == 0 || *page as usize > total {
            return Err(format!("Page {page} is outside 1–{total}"));
        }
        if !seen.insert(*page) {
            return Err(format!("Page {page} appears more than once"));
        }
    }
    Ok(())
}

fn catalog_id(doc: &Document) -> Result<ObjectId, String> {
    doc.trailer
        .get(b"Root")
        .map_err(|_| "PDF catalog is missing".to_string())?
        .as_reference()
        .map_err(|_| "PDF catalog reference is invalid".to_string())
}

fn retain_pages_in_order(doc: &mut Document, order: &[u32]) -> Result<(), String> {
    let pages = doc.get_pages();
    validate_page_list(order, pages.len(), false)?;
    let ids: Vec<ObjectId> = order
        .iter()
        .map(|page| pages.get(page).copied().ok_or_else(|| format!("Page {page} is missing")))
        .collect::<Result<_, _>>()?;

    let pages_id = doc.new_object_id();
    for page_id in &ids {
        let page = doc
            .get_object_mut(*page_id)
            .map_err(|error| error.to_string())?
            .as_dict_mut()
            .map_err(|error| error.to_string())?;
        page.set("Parent", pages_id);
    }

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => ids.len() as i64,
        }),
    );

    let catalog_id = catalog_id(doc)?;
    let catalog = doc
        .get_object_mut(catalog_id)
        .map_err(|error| error.to_string())?
        .as_dict_mut()
        .map_err(|error| error.to_string())?;
    catalog.set("Pages", pages_id);
    catalog.remove(b"Outlines");
    catalog.remove(b"PageLabels");

    doc.prune_objects();
    doc.renumber_objects();
    Ok(())
}

fn save_pdf(mut doc: Document, output: &Path) -> Result<String, String> {
    doc.save(output)
        .map_err(|error| format!("Could not save PDF: {error}"))?;
    Ok(path_string(output))
}

#[tauri::command]
pub fn pdf_info(path: String) -> Result<PdfInfo, String> {
    let path_buf = PathBuf::from(&path);
    let doc = load_pdf(&path_buf)?;
    Ok(PdfInfo {
        path,
        pages: doc.get_pages().len(),
        encrypted: doc.is_encrypted(),
        metadata: metadata_entries(&doc),
    })
}

#[tauri::command]
pub fn extract_pdf_pages(path: String, pages: Vec<u32>, destination: String) -> Result<PdfOperationResult, String> {
    let source = PathBuf::from(&path);
    let destination = PathBuf::from(destination);
    let mut doc = load_pdf(&source)?;
    retain_pages_in_order(&mut doc, &pages)?;
    let output = unique_output(&destination, &format!("{} - extracted", stem(&source)));
    let output = save_pdf(doc, &output)?;
    Ok(PdfOperationResult { paths: vec![output], pages: pages.len() })
}

#[tauri::command]
pub fn split_pdf_pages(path: String, pages: Vec<u32>, destination: String) -> Result<PdfOperationResult, String> {
    let source = PathBuf::from(&path);
    let destination = PathBuf::from(destination);
    let original = load_pdf(&source)?;
    validate_page_list(&pages, original.get_pages().len(), false)?;
    let mut outputs = Vec::with_capacity(pages.len());
    for page in &pages {
        let mut doc = original.clone();
        retain_pages_in_order(&mut doc, &[*page])?;
        let output = unique_output(&destination, &format!("{} - page {}", stem(&source), page));
        outputs.push(save_pdf(doc, &output)?);
    }
    Ok(PdfOperationResult { paths: outputs, pages: pages.len() })
}

#[tauri::command]
pub fn delete_pdf_pages(path: String, pages: Vec<u32>, destination: String) -> Result<PdfOperationResult, String> {
    let source = PathBuf::from(&path);
    let destination = PathBuf::from(destination);
    let mut doc = load_pdf(&source)?;
    let total = doc.get_pages().len();
    validate_page_list(&pages, total, false)?;
    let removed: HashSet<u32> = pages.iter().copied().collect();
    let keep: Vec<u32> = (1..=total as u32).filter(|page| !removed.contains(page)).collect();
    if keep.is_empty() {
        return Err("A PDF must keep at least one page".into());
    }
    retain_pages_in_order(&mut doc, &keep)?;
    let output = unique_output(&destination, &format!("{} - pages removed", stem(&source)));
    let output = save_pdf(doc, &output)?;
    Ok(PdfOperationResult { paths: vec![output], pages: keep.len() })
}

#[tauri::command]
pub fn reorder_pdf_pages(path: String, pages: Vec<u32>, destination: String) -> Result<PdfOperationResult, String> {
    let source = PathBuf::from(&path);
    let destination = PathBuf::from(destination);
    let mut doc = load_pdf(&source)?;
    let total = doc.get_pages().len();
    validate_page_list(&pages, total, false)?;
    if pages.len() != total {
        return Err(format!("Reorder must contain all {total} pages exactly once"));
    }
    retain_pages_in_order(&mut doc, &pages)?;
    let output = unique_output(&destination, &format!("{} - reordered", stem(&source)));
    let output = save_pdf(doc, &output)?;
    Ok(PdfOperationResult { paths: vec![output], pages })
}

#[tauri::command]
pub fn rotate_pdf_pages(path: String, pages: Vec<u32>, angle: i64, destination: String) -> Result<PdfOperationResult, String> {
    if angle % 90 != 0 {
        return Err("Rotation must be a multiple of 90°".into());
    }
    let source = PathBuf::from(&path);
    let destination = PathBuf::from(destination);
    let mut doc = load_pdf(&source)?;
    let page_map = doc.get_pages();
    let selected: Vec<u32> = if pages.is_empty() {
        page_map.keys().copied().collect()
    } else {
        validate_page_list(&pages, page_map.len(), false)?;
        pages
    };
    for page_number in &selected {
        let page_id = page_map.get(page_number).ok_or_else(|| format!("Page {page_number} is missing"))?;
        let page = doc
            .get_object_mut(*page_id)
            .map_err(|error| error.to_string())?
            .as_dict_mut()
            .map_err(|error| error.to_string())?;
        let current = page.get(b"Rotate").and_then(Object::as_i64).unwrap_or(0);
        let next = (current + angle).rem_euclid(360);
        if next == 0 {
            page.remove(b"Rotate");
        } else {
            page.set("Rotate", next);
        }
    }
    let output = unique_output(&destination, &format!("{} - rotated", stem(&source)));
    let output = save_pdf(doc, &output)?;
    Ok(PdfOperationResult { paths: vec![output], pages: selected.len() })
}

#[tauri::command]
pub fn compress_pdf(path: String, destination: String) -> Result<PdfOperationResult, String> {
    let source = PathBuf::from(&path);
    let destination = PathBuf::from(destination);
    let mut doc = load_pdf(&source)?;
    let pages = doc.get_pages().len();
    doc.delete_zero_length_streams();
    doc.prune_objects();
    doc.compress();
    doc.renumber_objects();
    let output = unique_output(&destination, &format!("{} - compressed", stem(&source)));
    let output = save_pdf(doc, &output)?;
    Ok(PdfOperationResult { paths: vec![output], pages })
}

#[tauri::command]
pub fn strip_pdf_metadata(path: String, destination: String) -> Result<PdfOperationResult, String> {
    let source = PathBuf::from(&path);
    let destination = PathBuf::from(destination);
    let mut doc = load_pdf(&source)?;
    let pages = doc.get_pages().len();
    doc.trailer.remove(b"Info");
    let catalog_id = catalog_id(&doc)?;
    if let Ok(catalog) = doc.get_object_mut(catalog_id).and_then(Object::as_dict_mut) {
        catalog.remove(b"Metadata");
    }
    doc.prune_objects();
    doc.renumber_objects();
    let output = unique_output(&destination, &format!("{} - metadata removed", stem(&source)));
    let output = save_pdf(doc, &output)?;
    Ok(PdfOperationResult { paths: vec![output], pages })
}

#[tauri::command]
pub fn merge_pdfs(paths: Vec<String>, destination: String) -> Result<PdfOperationResult, String> {
    if paths.len() < 2 {
        return Err("Select at least two PDFs to merge".into());
    }
    let destination = PathBuf::from(destination);
    let first_source = PathBuf::from(&paths[0]);
    let mut max_id = 1;
    let mut documents_pages: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut documents_objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut document = Document::with_version("1.5");

    for raw_path in &paths {
        let source = PathBuf::from(raw_path);
        let mut doc = load_pdf(&source)?;
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;
        for object_id in doc.get_pages().into_values() {
            let object = doc
                .get_object(object_id)
                .map_err(|error| error.to_string())?
                .to_owned();
            documents_pages.insert(object_id, object);
        }
        documents_objects.extend(doc.objects);
    }

    let mut catalog_object: Option<(ObjectId, Object)> = None;
    let mut pages_object: Option<(ObjectId, Object)> = None;
    for (object_id, object) in documents_objects {
        match object.type_name().unwrap_or(b"") {
            b"Catalog" => {
                let id = catalog_object.as_ref().map(|value| value.0).unwrap_or(object_id);
                catalog_object = Some((id, object));
            }
            b"Pages" => {
                if let Ok(dictionary) = object.as_dict() {
                    let mut dictionary = dictionary.clone();
                    if let Some((_, old)) = &pages_object {
                        if let Ok(old_dictionary) = old.as_dict() {
                            dictionary.extend(old_dictionary);
                        }
                    }
                    let id = pages_object.as_ref().map(|value| value.0).unwrap_or(object_id);
                    pages_object = Some((id, Object::Dictionary(dictionary)));
                }
            }
            b"Page" | b"Outlines" | b"Outline" => {}
            _ => {
                document.objects.insert(object_id, object);
            }
        }
    }

    let (page_root_id, page_root_object) = pages_object.ok_or_else(|| "PDF pages root was not found".to_string())?;
    for (object_id, object) in &documents_pages {
        let mut dictionary = object
            .as_dict()
            .map_err(|error| error.to_string())?
            .clone();
        dictionary.set("Parent", page_root_id);
        document.objects.insert(*object_id, Object::Dictionary(dictionary));
    }
    let mut pages_dictionary = page_root_object
        .as_dict()
        .map_err(|error| error.to_string())?
        .clone();
    pages_dictionary.set("Count", documents_pages.len() as i64);
    pages_dictionary.set(
        "Kids",
        documents_pages
            .keys()
            .copied()
            .map(Object::Reference)
            .collect::<Vec<_>>(),
    );
    document.objects.insert(page_root_id, Object::Dictionary(pages_dictionary));

    let (catalog_id, catalog_object) = catalog_object.ok_or_else(|| "PDF catalog was not found".to_string())?;
    let mut catalog_dictionary = catalog_object
        .as_dict()
        .map_err(|error| error.to_string())?
        .clone();
    catalog_dictionary.set("Pages", page_root_id);
    catalog_dictionary.remove(b"Outlines");
    catalog_dictionary.remove(b"PageLabels");
    document.objects.insert(catalog_id, Object::Dictionary(catalog_dictionary));
    document.trailer.set("Root", catalog_id);
    document.max_id = max_id;
    document.prune_objects();
    document.renumber_objects();
    document.compress();

    let output = unique_output(&destination, &format!("{} - merged", stem(&first_source)));
    let output = save_pdf(document, &output)?;
    Ok(PdfOperationResult { paths: vec![output], pages: documents_pages.len() })
}

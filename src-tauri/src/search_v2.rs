use rusqlite::{params_from_iter, types::Value, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::{DirEntry, WalkDir};

const DEFAULT_LIMIT: usize = 40;
const MAX_LIMIT: usize = 100;
const INDEX_CANDIDATE_LIMIT: usize = 10_000;
const DEEP_ENTRY_LIMIT: usize = 250_000;
const DEEP_CONTENT_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Comparison {
    Lt,
    Le,
    Eq,
    Ge,
    Gt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SizeFilter {
    comparison: Comparison,
    bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ModifiedFilter {
    max_age_ms: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ParsedSearchQuery {
    terms: Vec<String>,
    kinds: Vec<String>,
    extensions: Vec<String>,
    path_terms: Vec<String>,
    content_terms: Vec<String>,
    size_filters: Vec<SizeFilter>,
    modified_filters: Vec<ModifiedFilter>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultV2 {
    path: String,
    name: String,
    parent: String,
    kind: String,
    extension: Option<String>,
    size: Option<u64>,
    modified_ms: Option<i64>,
    score: f64,
    match_context: Option<String>,
}

#[derive(Debug)]
struct Candidate {
    path: String,
    name: String,
    parent: String,
    kind: String,
    extension: Option<String>,
    modified_ms: Option<i64>,
    size: Option<u64>,
    opened_count: i64,
    last_opened_ms: Option<i64>,
    content_sample: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn database_path() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Scout could not determine a local data directory".to_string())?;
    Ok(base.join("Scout").join("index.sqlite3"))
}

fn connection() -> Result<Connection, String> {
    Connection::open(database_path()?).map_err(|error| error.to_string())
}

fn tokenize(query: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for character in query.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if character == active {
                quote = None;
            } else {
                current.push(character);
            }
            continue;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
        } else if character.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if escaped {
        current.push('\\');
    }
    if quote.is_some() {
        return Err("Search query has an unterminated quote".into());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

fn parse_size(value: &str) -> Result<SizeFilter, String> {
    let value = value.trim().to_ascii_lowercase();
    let (comparison, rest) = if let Some(rest) = value.strip_prefix(">=") {
        (Comparison::Ge, rest)
    } else if let Some(rest) = value.strip_prefix("<=") {
        (Comparison::Le, rest)
    } else if let Some(rest) = value.strip_prefix('>') {
        (Comparison::Gt, rest)
    } else if let Some(rest) = value.strip_prefix('<') {
        (Comparison::Lt, rest)
    } else if let Some(rest) = value.strip_prefix('=') {
        (Comparison::Eq, rest)
    } else {
        (Comparison::Eq, value.as_str())
    };

    let split = rest
        .char_indices()
        .find(|(_, character)| !character.is_ascii_digit() && *character != '.')
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    let number = rest[..split]
        .parse::<f64>()
        .map_err(|_| format!("Invalid size filter: {value}"))?;
    if !number.is_finite() || number < 0.0 {
        return Err(format!("Invalid size filter: {value}"));
    }
    let unit = rest[split..].trim();
    let multiplier = match unit {
        "" | "b" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return Err(format!("Unknown size unit in size:{value}")),
    };
    let bytes = number * multiplier;
    if bytes > u64::MAX as f64 {
        return Err("Size filter is too large".into());
    }
    Ok(SizeFilter { comparison, bytes: bytes.round() as u64 })
}

fn parse_modified(value: &str) -> Result<ModifiedFilter, String> {
    let value = value.trim().to_ascii_lowercase();
    if value == "today" {
        return Ok(ModifiedFilter { max_age_ms: 86_400_000 });
    }
    let split = value
        .char_indices()
        .find(|(_, character)| !character.is_ascii_digit() && *character != '.')
        .map(|(index, _)| index)
        .unwrap_or(value.len());
    let number = value[..split]
        .parse::<f64>()
        .map_err(|_| format!("Invalid modified filter: {value}"))?;
    if !number.is_finite() || number < 0.0 {
        return Err(format!("Invalid modified filter: {value}"));
    }
    let unit_ms = match value[split..].trim() {
        "h" | "hr" | "hour" | "hours" => 3_600_000.0,
        "d" | "day" | "days" => 86_400_000.0,
        "w" | "week" | "weeks" => 604_800_000.0,
        "m" | "mo" | "month" | "months" => 2_629_746_000.0,
        "y" | "yr" | "year" | "years" => 31_556_952_000.0,
        _ => return Err(format!("Use modified:24h, modified:7d, modified:30d, or modified:today (got {value})")),
    };
    let max_age_ms = number * unit_ms;
    if max_age_ms > i64::MAX as f64 {
        return Err("Modified filter is too large".into());
    }
    Ok(ModifiedFilter { max_age_ms: max_age_ms.round() as i64 })
}

fn normalize_kind(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    let normalized = match value.as_str() {
        "folder" | "dir" | "directory" => "directory",
        "file" | "symlink" | "image" | "video" | "audio" | "document" | "archive" | "code" => value.as_str(),
        _ => return Err(format!("Unknown type:{value}. Try file, folder, image, video, audio, document, archive, code, or symlink")),
    };
    Ok(normalized.to_string())
}

fn parse_query(query: &str) -> Result<ParsedSearchQuery, String> {
    let mut parsed = ParsedSearchQuery::default();
    for token in tokenize(query)? {
        let Some((prefix, value)) = token.split_once(':') else {
            parsed.terms.push(token.to_lowercase());
            continue;
        };
        let prefix = prefix.to_ascii_lowercase();
        let value = value.trim();
        match prefix.as_str() {
            "type" => {
                if value.is_empty() { return Err("type: needs a value".into()); }
                parsed.kinds.push(normalize_kind(value)?);
            }
            "ext" | "extension" => {
                let value = value.trim_start_matches('.').to_ascii_lowercase();
                if value.is_empty() { return Err("ext: needs a file extension".into()); }
                parsed.extensions.push(value);
            }
            "path" => {
                if value.is_empty() { return Err("path: needs text to match".into()); }
                parsed.path_terms.push(value.to_lowercase());
            }
            "content" => {
                if value.is_empty() { return Err("content: needs text to match".into()); }
                parsed.content_terms.push(value.to_lowercase());
            }
            "size" => parsed.size_filters.push(parse_size(value)?),
            "modified" => parsed.modified_filters.push(parse_modified(value)?),
            _ => parsed.terms.push(token.to_lowercase()),
        }
    }
    Ok(parsed)
}

fn escape_like(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars() {
        if matches!(character, '%' | '_' | '!') { result.push('!'); }
        result.push(character);
    }
    result
}

fn subsequence_pattern(value: &str) -> String {
    let mut result = String::from("%");
    for character in value.chars() {
        if matches!(character, '%' | '_' | '!') { result.push('!'); }
        result.push(character);
        result.push('%');
    }
    result
}

fn category_extensions(kind: &str) -> Option<&'static [&'static str]> {
    match kind {
        "image" => Some(&["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp", "ico", "heic", "avif", "svg"]),
        "video" => Some(&["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpeg", "mpg"]),
        "audio" => Some(&["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "aiff"]),
        "document" => Some(&["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "markdown", "pages", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp"]),
        "archive" => Some(&["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz", "zst"]),
        "code" => Some(&["rs", "js", "jsx", "ts", "tsx", "py", "go", "java", "kt", "swift", "c", "h", "cc", "cpp", "cxx", "hpp", "cs", "rb", "php", "sh", "bash", "zsh", "fish", "sql", "html", "css", "scss", "json", "toml", "yaml", "yml", "xml"]),
        _ => None,
    }
}

fn push_type_clause(sql: &mut String, values: &mut Vec<Value>, kinds: &[String]) {
    if kinds.is_empty() { return; }
    sql.push_str(" AND (");
    for (index, kind) in kinds.iter().enumerate() {
        if index > 0 { sql.push_str(" OR "); }
        if let Some(extensions) = category_extensions(kind) {
            sql.push_str("(kind = 'file' AND lower(extension) IN (");
            for (ext_index, extension) in extensions.iter().enumerate() {
                if ext_index > 0 { sql.push(','); }
                sql.push('?');
                values.push(Value::Text((*extension).to_string()));
            }
            sql.push_str("))");
        } else {
            sql.push_str("kind = ?");
            values.push(Value::Text(kind.clone()));
        }
    }
    sql.push(')');
}

fn size_matches(size: Option<u64>, filter: &SizeFilter) -> bool {
    let Some(size) = size else { return false; };
    match filter.comparison {
        Comparison::Lt => size < filter.bytes,
        Comparison::Le => size <= filter.bytes,
        Comparison::Eq => size == filter.bytes,
        Comparison::Ge => size >= filter.bytes,
        Comparison::Gt => size > filter.bytes,
    }
}

fn fuzzy_score(haystack: &str, needle: &str) -> Option<f64> {
    if needle.is_empty() { return Some(0.0); }
    let haystack = haystack.to_lowercase();
    let needle = needle.to_lowercase();
    if haystack == needle { return Some(1000.0); }
    if haystack.starts_with(&needle) { return Some(850.0 - haystack.len() as f64 * 0.05); }
    if let Some(position) = haystack.find(&needle) {
        return Some(650.0 - position as f64 * 3.0 - haystack.len() as f64 * 0.02);
    }
    let mut wanted = needle.chars();
    let mut current = wanted.next()?;
    let mut previous = None;
    let mut first = None;
    let mut gap = 0.0;
    let mut matched = 0usize;
    for (index, character) in haystack.chars().enumerate() {
        if character != current { continue; }
        first.get_or_insert(index);
        if let Some(previous) = previous { gap += index.saturating_sub(previous + 1) as f64 * 2.5; }
        previous = Some(index);
        matched += 1;
        if let Some(next) = wanted.next() { current = next; } else {
            return Some(420.0 + matched as f64 * 8.0 - gap - first.unwrap_or(0) as f64 * 2.0);
        }
    }
    None
}

fn usage_boost(opened_count: i64, last_opened_ms: Option<i64>) -> f64 {
    let frequency = (opened_count.max(0) as f64 + 1.0).ln() * 30.0;
    let recency = last_opened_ms.map(|last| {
        let age_days = ((now_ms() - last).max(0) as f64) / 86_400_000.0;
        80.0 / (1.0 + age_days / 7.0)
    }).unwrap_or(0.0);
    frequency + recency
}

fn content_context(content: &str, terms: &[String]) -> Option<String> {
    let line = content.lines().find(|line| {
        let lower = line.to_lowercase();
        terms.iter().any(|term| lower.contains(term))
    })?;
    let compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 160 { return Some(compact); }
    let mut snippet: String = compact.chars().take(159).collect();
    snippet.push('…');
    Some(snippet)
}

fn score_candidate(candidate: Candidate, parsed: &ParsedSearchQuery) -> Option<SearchResultV2> {
    let content_lower = candidate.content_sample.as_deref().unwrap_or_default().to_lowercase();
    if !parsed.content_terms.iter().all(|term| content_lower.contains(term)) { return None; }
    if !parsed.path_terms.iter().all(|term| candidate.path.to_lowercase().contains(term)) { return None; }
    if !parsed.size_filters.iter().all(|filter| size_matches(candidate.size, filter)) { return None; }
    let now = now_ms();
    if !parsed.modified_filters.iter().all(|filter| candidate.modified_ms.is_some_and(|modified| modified >= now - filter.max_age_ms)) { return None; }

    let mut score = usage_boost(candidate.opened_count, candidate.last_opened_ms);
    let mut content_matches = parsed.content_terms.clone();
    for term in &parsed.terms {
        let name = fuzzy_score(&candidate.name, term).unwrap_or(0.0);
        let path = fuzzy_score(&candidate.path, term).unwrap_or(0.0) * 0.38;
        let content = if content_lower.contains(term) { content_matches.push(term.clone()); 210.0 } else { 0.0 };
        if name <= 0.0 && path <= 0.0 && content <= 0.0 { return None; }
        score += name + path + content;
    }
    if candidate.kind == "directory" { score += 8.0; }
    Some(SearchResultV2 {
        path: candidate.path,
        name: candidate.name,
        parent: candidate.parent,
        kind: candidate.kind,
        extension: candidate.extension,
        size: candidate.size,
        modified_ms: candidate.modified_ms,
        score,
        match_context: candidate.content_sample.as_deref().and_then(|content| content_context(content, &content_matches)),
    })
}

#[tauri::command]
pub fn search_index_v2(query: String, limit: Option<usize>) -> Result<Vec<SearchResultV2>, String> {
    let parsed = parse_query(query.trim())?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let connection = connection()?;
    let mut sql = String::from(
        "SELECT path, name, parent, kind, extension, modified_ms, size, opened_count, last_opened_ms, content_sample FROM entries WHERE 1=1",
    );
    let mut values: Vec<Value> = Vec::new();

    for term in &parsed.terms {
        let pattern = subsequence_pattern(term);
        let content_pattern = format!("%{}%", escape_like(term));
        sql.push_str(" AND (lower(name) LIKE ? ESCAPE '!' OR lower(path) LIKE ? ESCAPE '!' OR lower(content_sample) LIKE ? ESCAPE '!')");
        values.push(Value::Text(pattern.clone()));
        values.push(Value::Text(pattern));
        values.push(Value::Text(content_pattern));
    }
    for term in &parsed.path_terms {
        sql.push_str(" AND lower(path) LIKE ? ESCAPE '!'");
        values.push(Value::Text(format!("%{}%", escape_like(term))));
    }
    for term in &parsed.content_terms {
        sql.push_str(" AND lower(content_sample) LIKE ? ESCAPE '!'");
        values.push(Value::Text(format!("%{}%", escape_like(term))));
    }
    if !parsed.extensions.is_empty() {
        sql.push_str(" AND lower(extension) IN (");
        for (index, extension) in parsed.extensions.iter().enumerate() {
            if index > 0 { sql.push(','); }
            sql.push('?');
            values.push(Value::Text(extension.clone()));
        }
        sql.push(')');
    }
    push_type_clause(&mut sql, &mut values, &parsed.kinds);
    for filter in &parsed.size_filters {
        let operator = match filter.comparison { Comparison::Lt => "<", Comparison::Le => "<=", Comparison::Eq => "=", Comparison::Ge => ">=", Comparison::Gt => ">" };
        sql.push_str(&format!(" AND size {operator} ?"));
        values.push(Value::Integer(filter.bytes.min(i64::MAX as u64) as i64));
    }
    let now = now_ms();
    for filter in &parsed.modified_filters {
        sql.push_str(" AND modified_ms >= ?");
        values.push(Value::Integer(now - filter.max_age_ms));
    }
    sql.push_str(" ORDER BY opened_count DESC, last_opened_ms DESC, length(path) ASC LIMIT ?");
    values.push(Value::Integer(INDEX_CANDIDATE_LIMIT.max(limit * 20) as i64));

    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params_from_iter(values), |row| {
        let raw_size: Option<i64> = row.get(6)?;
        Ok(Candidate {
            path: row.get(0)?,
            name: row.get(1)?,
            parent: row.get(2)?,
            kind: row.get(3)?,
            extension: row.get(4)?,
            modified_ms: row.get(5)?,
            size: raw_size.and_then(|value| u64::try_from(value).ok()),
            opened_count: row.get(7)?,
            last_opened_ms: row.get(8)?,
            content_sample: row.get(9)?,
        })
    }).map_err(|error| error.to_string())?;

    let mut results = rows
        .filter_map(Result::ok)
        .filter_map(|candidate| score_candidate(candidate, &parsed))
        .collect::<Vec<_>>();
    results.sort_by(|left, right| right.score.total_cmp(&left.score).then_with(|| left.path.cmp(&right.path)));
    results.truncate(limit);
    Ok(results)
}

fn skipped_directory(entry: &DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() { return false; }
    matches!(entry.file_name().to_string_lossy().as_ref(), ".git" | ".svn" | ".hg" | "node_modules" | "target" | ".cache" | ".Trash" | ".Trashes" | "$RECYCLE.BIN" | "System Volume Information")
}

fn extension(path: &Path) -> Option<String> {
    path.extension().map(|value| value.to_string_lossy().to_ascii_lowercase())
}

fn kind_matches(kind: &str, extension: Option<&str>, filters: &[String]) -> bool {
    filters.is_empty() || filters.iter().any(|filter| {
        if let Some(extensions) = category_extensions(filter) {
            kind == "file" && extension.is_some_and(|extension| extensions.contains(&extension))
        } else {
            kind == filter
        }
    })
}

fn metadata_matches(parsed: &ParsedSearchQuery, path: &Path, kind: &str, extension: Option<&str>, size: Option<u64>, modified_ms: Option<i64>) -> bool {
    if !kind_matches(kind, extension, &parsed.kinds) { return false; }
    if !parsed.extensions.is_empty() && !extension.is_some_and(|extension| parsed.extensions.iter().any(|wanted| wanted == extension)) { return false; }
    let lower_path = path.to_string_lossy().to_lowercase();
    if !parsed.path_terms.iter().all(|term| lower_path.contains(term)) { return false; }
    if !parsed.size_filters.iter().all(|filter| size_matches(size, filter)) { return false; }
    let now = now_ms();
    parsed.modified_filters.iter().all(|filter| modified_ms.is_some_and(|modified| modified >= now - filter.max_age_ms))
}

fn deep_content(path: &Path, metadata: &fs::Metadata) -> Option<String> {
    if !metadata.is_file() || metadata.len() > DEEP_CONTENT_LIMIT { return None; }
    let mut file = File::open(path).ok()?;
    let mut bytes = Vec::with_capacity(metadata.len().min(DEEP_CONTENT_LIMIT) as usize);
    file.take(DEEP_CONTENT_LIMIT).read_to_end(&mut bytes).ok()?;
    if bytes.iter().take(8192).any(|byte| *byte == 0) { return None; }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn modified_ms(metadata: &fs::Metadata) -> Option<i64> {
    metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok().and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn deep_root(root: Option<String>) -> Result<PathBuf, String> {
    if let Some(root) = root {
        let root = PathBuf::from(root);
        if root.is_dir() { return Ok(root); }
        return Err(format!("Deep Search root is not a directory: {}", root.display()));
    }
    if let Ok(connection) = connection() {
        let indexed: Option<String> = connection.query_row("SELECT value FROM meta WHERE key = 'root'", [], |row| row.get(0)).optional().map_err(|error| error.to_string())?;
        if let Some(indexed) = indexed {
            let path = PathBuf::from(indexed);
            if path.is_dir() { return Ok(path); }
        }
    }
    dirs::home_dir().ok_or_else(|| "Scout could not determine a Deep Search root".to_string())
}

fn deep_search_sync(root: Option<String>, query: String, limit: Option<usize>) -> Result<Vec<SearchResultV2>, String> {
    let parsed = parse_query(query.trim())?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    if parsed == ParsedSearchQuery::default() { return Ok(Vec::new()); }
    let root = deep_root(root)?;
    let mut results = Vec::new();
    let mut visited = 0usize;

    for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_entry(|entry| !skipped_directory(entry)) {
        if visited >= DEEP_ENTRY_LIMIT { break; }
        let Ok(entry) = entry else { continue; };
        if entry.depth() == 0 { continue; }
        visited += 1;
        let Ok(metadata) = entry.metadata() else { continue; };
        let kind = if entry.file_type().is_dir() { "directory" } else if entry.file_type().is_file() { "file" } else if entry.file_type().is_symlink() { "symlink" } else { "other" };
        let ext = extension(entry.path());
        let size = metadata.is_file().then_some(metadata.len());
        let modified = modified_ms(&metadata);
        if !metadata_matches(&parsed, entry.path(), kind, ext.as_deref(), size, modified) { continue; }

        let name = entry.file_name().to_string_lossy().into_owned();
        let path_string = entry.path().to_string_lossy().into_owned();
        let mut score = if kind == "directory" { 8.0 } else { 0.0 };
        let mut unmatched_terms = Vec::new();
        for term in &parsed.terms {
            let name_score = fuzzy_score(&name, term).unwrap_or(0.0);
            let path_score = fuzzy_score(&path_string, term).unwrap_or(0.0) * 0.38;
            if name_score <= 0.0 && path_score <= 0.0 { unmatched_terms.push(term.clone()); }
            else { score += name_score + path_score; }
        }

        let needs_content = !parsed.content_terms.is_empty() || !unmatched_terms.is_empty();
        let content = if needs_content { deep_content(entry.path(), &metadata) } else { None };
        let content_lower = content.as_deref().unwrap_or_default().to_lowercase();
        if !parsed.content_terms.iter().all(|term| content_lower.contains(term)) { continue; }
        if !unmatched_terms.iter().all(|term| content_lower.contains(term)) { continue; }
        score += unmatched_terms.len() as f64 * 210.0 + parsed.content_terms.len() as f64 * 240.0;

        let mut context_terms = parsed.content_terms.clone();
        context_terms.extend(unmatched_terms);
        results.push(SearchResultV2 {
            path: path_string,
            name,
            parent: entry.path().parent().map(|value| value.to_string_lossy().into_owned()).unwrap_or_default(),
            kind: kind.to_string(),
            extension: ext,
            size,
            modified_ms: modified,
            score,
            match_context: content.as_deref().and_then(|content| content_context(content, &context_terms)),
        });
    }
    results.sort_by(|left, right| right.score.total_cmp(&left.score).then_with(|| left.path.cmp(&right.path)));
    results.truncate(limit);
    Ok(results)
}

#[tauri::command]
pub async fn deep_search(root: Option<String>, query: String, limit: Option<usize>) -> Result<Vec<SearchResultV2>, String> {
    tauri::async_runtime::spawn_blocking(move || deep_search_sync(root, query, limit))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizes_quoted_filters() {
        assert_eq!(tokenize("invoice path:\"Client Files\" content:'hello world'").unwrap(), vec!["invoice", "path:Client Files", "content:hello world"]);
    }

    #[test]
    fn parses_mixed_query() {
        let query = parse_query("invoice type:pdf ext:PDF size:>5mb modified:7d path:\"Client Files\" content:total").unwrap_err();
        assert!(query.contains("Unknown type:pdf"));
        let query = parse_query("invoice type:document ext:PDF size:>5mb modified:7d path:\"Client Files\" content:total").unwrap();
        assert_eq!(query.terms, vec!["invoice"]);
        assert_eq!(query.kinds, vec!["document"]);
        assert_eq!(query.extensions, vec!["pdf"]);
        assert_eq!(query.path_terms, vec!["client files"]);
        assert_eq!(query.content_terms, vec!["total"]);
        assert_eq!(query.size_filters[0].comparison, Comparison::Gt);
        assert_eq!(query.size_filters[0].bytes, 5 * 1024 * 1024);
        assert_eq!(query.modified_filters[0].max_age_ms, 7 * 86_400_000);
    }

    #[test]
    fn parses_size_units_and_comparisons() {
        assert_eq!(parse_size(">=1.5mb").unwrap(), SizeFilter { comparison: Comparison::Ge, bytes: 1_572_864 });
        assert_eq!(parse_size("<2gb").unwrap().bytes, 2 * 1024 * 1024 * 1024);
    }

    #[test]
    fn rejects_bad_filters() {
        assert!(parse_query("size:huge").is_err());
        assert!(parse_query("modified:yesterday").is_err());
        assert!(parse_query("type:banana").is_err());
        assert!(tokenize("path:\"unfinished").is_err());
    }

    #[test]
    fn semantic_types_are_stable() {
        assert!(category_extensions("image").unwrap().contains(&"png"));
        assert!(category_extensions("code").unwrap().contains(&"rs"));
        assert!(kind_matches("directory", None, &["directory".into()]));
        assert!(kind_matches("file", Some("mp4"), &["video".into()]));
    }
}

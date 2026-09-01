use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::{DirEntry, WalkDir};

const INDEX_VERSION: u32 = 2;
const INDEX_ENTRY_LIMIT: usize = 250_000;
const SEARCH_CANDIDATE_LIMIT: usize = 3_000;
const DEFAULT_SEARCH_LIMIT: usize = 40;
const CONTENT_FILE_SIZE_LIMIT: u64 = 1024 * 1024;
const CONTENT_SAMPLE_LIMIT: u64 = 16 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    count: u64,
    root: Option<String>,
    last_indexed_ms: Option<i64>,
    version: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    path: String,
    name: String,
    parent: String,
    kind: String,
    extension: Option<String>,
    score: f64,
    match_context: Option<String>,
}

struct Candidate {
    path: String,
    name: String,
    parent: String,
    kind: String,
    extension: Option<String>,
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
    let directory = base.join("Scout");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("index.sqlite3"))
}

fn ensure_content_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(entries)")
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    if !columns.iter().any(|column| column == "content_sample") {
        connection
            .execute("ALTER TABLE entries ADD COLUMN content_sample TEXT", [])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn connection() -> Result<Connection, String> {
    let connection = Connection::open(database_path()?).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS entries (
               path TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               parent TEXT NOT NULL,
               kind TEXT NOT NULL,
               extension TEXT,
               modified_ms INTEGER,
               size INTEGER,
               opened_count INTEGER NOT NULL DEFAULT 0,
               last_opened_ms INTEGER,
               generation INTEGER NOT NULL DEFAULT 0,
               content_sample TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_entries_name ON entries(name COLLATE NOCASE);
             CREATE INDEX IF NOT EXISTS idx_entries_parent ON entries(parent);
             CREATE INDEX IF NOT EXISTS idx_entries_usage ON entries(opened_count DESC, last_opened_ms DESC);
             CREATE TABLE IF NOT EXISTS meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
    ensure_content_column(&connection)?;
    Ok(connection)
}

fn meta_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| row.get(0))
        .optional()
        .map_err(|error| error.to_string())
}

fn status_from_connection(connection: &Connection) -> Result<IndexStatus, String> {
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let root = meta_value(connection, "root")?;
    let last_indexed_ms = meta_value(connection, "last_indexed_ms")?
        .and_then(|value| value.parse::<i64>().ok());
    let version = meta_value(connection, "version")?
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    Ok(IndexStatus {
        count: count.max(0) as u64,
        root,
        last_indexed_ms,
        version,
    })
}

fn skipped_directory(entry: &DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return false;
    }
    matches!(
        entry.file_name().to_string_lossy().as_ref(),
        ".git"
            | ".svn"
            | ".hg"
            | "node_modules"
            | "target"
            | ".cache"
            | ".Trash"
            | ".Trashes"
            | "$RECYCLE.BIN"
            | "System Volume Information"
    )
}

fn modified_ms(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
}

fn content_searchable_extension(extension: Option<&str>) -> bool {
    matches!(
        extension,
        Some(
            "txt"
                | "text"
                | "log"
                | "csv"
                | "tsv"
                | "md"
                | "markdown"
                | "json"
                | "jsonc"
                | "toml"
                | "yaml"
                | "yml"
                | "xml"
                | "html"
                | "htm"
                | "css"
                | "scss"
                | "less"
                | "js"
                | "jsx"
                | "mjs"
                | "cjs"
                | "ts"
                | "tsx"
                | "rs"
                | "py"
                | "rb"
                | "go"
                | "java"
                | "kt"
                | "kts"
                | "swift"
                | "c"
                | "h"
                | "cc"
                | "cpp"
                | "cxx"
                | "hpp"
                | "cs"
                | "php"
                | "sh"
                | "bash"
                | "zsh"
                | "fish"
                | "ps1"
                | "sql"
                | "ini"
                | "cfg"
                | "conf"
                | "env"
        )
    )
}

fn read_content_sample(path: &Path, metadata: &fs::Metadata) -> Option<String> {
    if !metadata.is_file() || metadata.len() > CONTENT_FILE_SIZE_LIMIT {
        return None;
    }
    let file_extension = extension(path);
    if !content_searchable_extension(file_extension.as_deref()) {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(CONTENT_SAMPLE_LIMIT).read_to_end(&mut bytes).ok()?;
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn rebuild_index_sync(root: Option<String>) -> Result<IndexStatus, String> {
    let requested_root = root
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Scout could not determine a home directory to index".to_string())?;
    if !requested_root.is_dir() {
        return Err(format!("Index root is not a directory: {}", requested_root.display()));
    }
    let root = fs::canonicalize(&requested_root).unwrap_or(requested_root);
    let root_string = root.to_string_lossy().into_owned();
    let generation = now_ms();
    let mut connection = connection()?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let mut indexed = 0usize;

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !skipped_directory(entry))
    {
        if indexed >= INDEX_ENTRY_LIMIT {
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        let path_ref = entry.path();
        let kind = if entry.file_type().is_dir() {
            "directory"
        } else if entry.file_type().is_file() {
            "file"
        } else if entry.file_type().is_symlink() {
            "symlink"
        } else {
            "other"
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let parent = path_ref
            .parent()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        let size = metadata.is_file().then_some(metadata.len().min(i64::MAX as u64) as i64);
        let content_sample = read_content_sample(path_ref, &metadata);
        let path = path_ref.to_string_lossy().into_owned();

        transaction
            .execute(
                "INSERT INTO entries (
                   path, name, parent, kind, extension, modified_ms, size, generation, content_sample
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(path) DO UPDATE SET
                   name = excluded.name,
                   parent = excluded.parent,
                   kind = excluded.kind,
                   extension = excluded.extension,
                   modified_ms = excluded.modified_ms,
                   size = excluded.size,
                   generation = excluded.generation,
                   content_sample = excluded.content_sample",
                params![
                    path,
                    name,
                    parent,
                    kind,
                    extension(entry.path()),
                    modified_ms(&metadata),
                    size,
                    generation,
                    content_sample
                ],
            )
            .map_err(|error| error.to_string())?;
        indexed += 1;
    }

    transaction
        .execute("DELETE FROM entries WHERE generation <> ?1", [generation])
        .map_err(|error| error.to_string())?;
    for (key, value) in [
        ("root", root_string),
        ("last_indexed_ms", generation.to_string()),
        ("version", INDEX_VERSION.to_string()),
    ] {
        transaction
            .execute(
                "INSERT INTO meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;

    status_from_connection(&connection)
}

fn escape_like(query: &str) -> String {
    let mut result = String::new();
    for character in query.chars() {
        if matches!(character, '%' | '_' | '!') {
            result.push('!');
        }
        result.extend(character.to_lowercase());
    }
    result
}

fn like_subsequence_pattern(query: &str) -> String {
    let mut result = String::from("%");
    for character in query.chars() {
        if matches!(character, '%' | '_' | '!') {
            result.push('!');
        }
        result.extend(character.to_lowercase());
        result.push('%');
    }
    result
}

fn fuzzy_score(haystack: &str, needle: &str) -> Option<f64> {
    if needle.is_empty() {
        return Some(0.0);
    }
    let haystack = haystack.to_lowercase();
    let needle = needle.to_lowercase();
    if haystack == needle {
        return Some(1000.0);
    }
    if haystack.starts_with(&needle) {
        return Some(850.0 - haystack.len() as f64 * 0.05);
    }
    if let Some(position) = haystack.find(&needle) {
        return Some(650.0 - position as f64 * 3.0 - haystack.len() as f64 * 0.02);
    }

    let mut needle_chars = needle.chars();
    let mut wanted = needle_chars.next()?;
    let mut matched = 0usize;
    let mut first_match = None;
    let mut previous_match = None;
    let mut gap_penalty = 0.0;

    for (index, character) in haystack.chars().enumerate() {
        if character != wanted {
            continue;
        }
        first_match.get_or_insert(index);
        if let Some(previous) = previous_match {
            gap_penalty += index.saturating_sub(previous + 1) as f64 * 2.5;
        }
        previous_match = Some(index);
        matched += 1;
        if let Some(next) = needle_chars.next() {
            wanted = next;
        } else {
            let start_penalty = first_match.unwrap_or(0) as f64 * 2.0;
            return Some(420.0 + matched as f64 * 8.0 - gap_penalty - start_penalty);
        }
    }
    None
}

fn usage_boost(opened_count: i64, last_opened_ms: Option<i64>) -> f64 {
    let frequency = (opened_count.max(0) as f64 + 1.0).ln() * 30.0;
    let recency = last_opened_ms
        .map(|last| {
            let age_days = ((now_ms() - last).max(0) as f64) / 86_400_000.0;
            80.0 / (1.0 + age_days / 7.0)
        })
        .unwrap_or(0.0);
    frequency + recency
}

fn content_context(content: &str, query: &str) -> Option<String> {
    let line = content
        .lines()
        .find(|line| line.to_lowercase().contains(query))?;
    let compact = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 150 {
        return Some(compact);
    }
    let mut snippet: String = compact.chars().take(149).collect();
    snippet.push('…');
    Some(snippet)
}

fn score_candidate(candidate: Candidate, query: &str) -> Option<SearchResult> {
    let name_score = fuzzy_score(&candidate.name, query).unwrap_or(0.0);
    let path_score = fuzzy_score(&candidate.path, query).unwrap_or(0.0) * 0.38;
    let match_context = candidate
        .content_sample
        .as_deref()
        .and_then(|content| content_context(content, query));
    let content_score = if match_context.is_some() { 210.0 } else { 0.0 };
    if name_score <= 0.0 && path_score <= 0.0 && content_score <= 0.0 {
        return None;
    }
    let directory_boost = if candidate.kind == "directory" { 8.0 } else { 0.0 };
    Some(SearchResult {
        path: candidate.path,
        name: candidate.name,
        parent: candidate.parent,
        kind: candidate.kind,
        extension: candidate.extension,
        score: name_score
            + path_score
            + content_score
            + directory_boost
            + usage_boost(candidate.opened_count, candidate.last_opened_ms),
        match_context,
    })
}

#[tauri::command]
pub fn index_status() -> Result<IndexStatus, String> {
    status_from_connection(&connection()?)
}

#[tauri::command]
pub async fn rebuild_index(root: Option<String>) -> Result<IndexStatus, String> {
    tauri::async_runtime::spawn_blocking(move || rebuild_index_sync(root))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn search_index(query: String, limit: Option<usize>) -> Result<Vec<SearchResult>, String> {
    let connection = connection()?;
    let query = query.trim().to_lowercase();
    let limit = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).clamp(1, 100);

    if query.is_empty() {
        let mut statement = connection
            .prepare(
                "SELECT path, name, parent, kind, extension, opened_count, last_opened_ms
                 FROM entries
                 ORDER BY opened_count DESC, last_opened_ms DESC, length(path) ASC
                 LIMIT ?1",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([limit as i64], |row| {
                Ok(SearchResult {
                    path: row.get(0)?,
                    name: row.get(1)?,
                    parent: row.get(2)?,
                    kind: row.get(3)?,
                    extension: row.get(4)?,
                    score: 0.0,
                    match_context: None,
                })
            })
            .map_err(|error| error.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string());
    }

    let subsequence_pattern = like_subsequence_pattern(&query);
    let content_pattern = format!("%{}%", escape_like(&query));
    let mut statement = connection
        .prepare(
            "SELECT path, name, parent, kind, extension, opened_count, last_opened_ms, content_sample
             FROM entries
             WHERE lower(name) LIKE ?1 ESCAPE '!'
                OR lower(path) LIKE ?1 ESCAPE '!'
                OR lower(content_sample) LIKE ?2 ESCAPE '!'
             LIMIT ?3",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![subsequence_pattern, content_pattern, SEARCH_CANDIDATE_LIMIT as i64],
            |row| {
                Ok(Candidate {
                    path: row.get(0)?,
                    name: row.get(1)?,
                    parent: row.get(2)?,
                    kind: row.get(3)?,
                    extension: row.get(4)?,
                    opened_count: row.get(5)?,
                    last_opened_ms: row.get(6)?,
                    content_sample: row.get(7)?,
                })
            },
        )
        .map_err(|error| error.to_string())?;

    let mut results = rows
        .filter_map(Result::ok)
        .filter_map(|candidate| score_candidate(candidate, &query))
        .collect::<Vec<_>>();
    results.sort_by(|left, right| right.score.total_cmp(&left.score));
    results.truncate(limit);
    Ok(results)
}

#[tauri::command]
pub fn record_index_open(path: String) -> Result<(), String> {
    let connection = connection()?;
    connection
        .execute(
            "UPDATE entries
             SET opened_count = opened_count + 1, last_opened_ms = ?1
             WHERE path = ?2",
            params![now_ms(), path],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

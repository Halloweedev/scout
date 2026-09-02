use crate::queue::JobContext;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_TAG_LENGTH: usize = 64;
const MAX_TAGS_PER_ITEM: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaggedPath {
    path: String,
    tags: Vec<String>,
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
    Ok(directory.join("tags.sqlite3"))
}

fn connection() -> Result<Connection, String> {
    let connection = Connection::open(database_path()?).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS tags (
               path TEXT NOT NULL,
               tag TEXT NOT NULL COLLATE NOCASE,
               created_ms INTEGER NOT NULL,
               PRIMARY KEY(path, tag)
             );
             CREATE INDEX IF NOT EXISTS tags_tag_idx ON tags(tag COLLATE NOCASE);",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn normalize_tag(tag: &str) -> Result<String, String> {
    let tag = tag.trim();
    if tag.is_empty() {
        return Err("Tag cannot be empty".into());
    }
    if tag.chars().count() > MAX_TAG_LENGTH {
        return Err(format!("Tags can be at most {MAX_TAG_LENGTH} characters"));
    }
    if tag.chars().any(char::is_control) {
        return Err("Tags cannot contain control characters".into());
    }
    Ok(tag.to_string())
}

fn normalized_tags(tags: &[String]) -> Result<Vec<String>, String> {
    if tags.len() > MAX_TAGS_PER_ITEM {
        return Err(format!("Scout supports at most {MAX_TAGS_PER_ITEM} tags at once"));
    }
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = normalize_tag(tag)?;
        if !normalized.iter().any(|existing: &String| existing.eq_ignore_ascii_case(&tag)) {
            normalized.push(tag);
        }
    }
    Ok(normalized)
}

fn tags_for_path_with(connection: &Connection, path: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT tag FROM tags WHERE path = ?1 ORDER BY lower(tag), tag")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([path], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut tags = Vec::new();
    for row in rows {
        tags.push(row.map_err(|error| error.to_string())?);
    }
    Ok(tags)
}

fn rows_under(connection: &Connection, source: &Path) -> Result<Vec<(String, String, i64)>, String> {
    let mut statement = connection
        .prepare("SELECT path, tag, created_ms FROM tags")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut matches = Vec::new();
    for row in rows {
        let row = row.map_err(|error| error.to_string())?;
        if Path::new(&row.0).starts_with(source) {
            matches.push(row);
        }
    }
    Ok(matches)
}

fn remap_path(source_root: &Path, destination_root: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    match path.strip_prefix(source_root) {
        Ok(relative) if !relative.as_os_str().is_empty() => destination_root.join(relative),
        _ => destination_root.to_path_buf(),
    }
}

pub(crate) fn add_tags_to_path(path: &str, tags: &[String]) -> Result<Vec<String>, String> {
    if !Path::new(path).exists() {
        return Err("Cannot tag an item that no longer exists".into());
    }
    let tags = normalized_tags(tags)?;
    if tags.is_empty() {
        return Err("Choose at least one tag".into());
    }
    let connection = connection()?;
    let created_ms = now_ms();
    for tag in tags {
        connection
            .execute(
                "INSERT OR IGNORE INTO tags(path, tag, created_ms) VALUES (?1, ?2, ?3)",
                params![path, tag, created_ms],
            )
            .map_err(|error| error.to_string())?;
    }
    tags_for_path_with(&connection, path)
}

pub(crate) fn move_tag_path(source: &Path, destination: &Path) -> Result<(), String> {
    let mut connection = connection()?;
    let rows = rows_under(&connection, source)?;
    if rows.is_empty() {
        return Ok(());
    }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    for (old_path, tag, created_ms) in rows {
        let new_path = remap_path(source, destination, &old_path).to_string_lossy().into_owned();
        transaction
            .execute(
                "DELETE FROM tags WHERE path = ?1 AND tag = ?2 COLLATE NOCASE",
                params![old_path, tag],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT OR IGNORE INTO tags(path, tag, created_ms) VALUES (?1, ?2, ?3)",
                params![new_path, tag, created_ms],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn copy_tag_path(source: &Path, destination: &Path) -> Result<(), String> {
    let mut connection = connection()?;
    let rows = rows_under(&connection, source)?;
    if rows.is_empty() {
        return Ok(());
    }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    for (old_path, tag, created_ms) in rows {
        let new_path = remap_path(source, destination, &old_path).to_string_lossy().into_owned();
        transaction
            .execute(
                "INSERT OR IGNORE INTO tags(path, tag, created_ms) VALUES (?1, ?2, ?3)",
                params![new_path, tag, created_ms],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn delete_tag_path(source: &Path) -> Result<(), String> {
    let mut connection = connection()?;
    let rows = rows_under(&connection, source)?;
    if rows.is_empty() {
        return Ok(());
    }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    for (path, tag, _) in rows {
        transaction
            .execute(
                "DELETE FROM tags WHERE path = ?1 AND tag = ?2 COLLATE NOCASE",
                params![path, tag],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn has_tag(path: &str, tag: &str) -> Result<bool, String> {
    let connection = connection()?;
    let tag = normalize_tag(tag)?;
    connection
        .query_row(
            "SELECT 1 FROM tags WHERE path = ?1 AND tag = ?2 COLLATE NOCASE LIMIT 1",
            params![path, tag],
            |_| Ok(true),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tags_for_paths(paths: Vec<String>) -> Result<Vec<TaggedPath>, String> {
    let connection = connection()?;
    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        results.push(TaggedPath {
            tags: tags_for_path_with(&connection, &path)?,
            path,
        });
    }
    Ok(results)
}

#[tauri::command]
pub fn add_tags(paths: Vec<String>, tags: Vec<String>) -> Result<Vec<TaggedPath>, String> {
    let tags = normalized_tags(&tags)?;
    if tags.is_empty() {
        return Err("Choose at least one tag".into());
    }
    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        let current = add_tags_to_path(&path, &tags)?;
        results.push(TaggedPath { path, tags: current });
    }
    Ok(results)
}

#[tauri::command]
pub fn remove_tags(paths: Vec<String>, tags: Vec<String>) -> Result<Vec<TaggedPath>, String> {
    let tags = normalized_tags(&tags)?;
    if tags.is_empty() {
        return Err("Choose at least one tag".into());
    }
    let connection = connection()?;
    for path in &paths {
        for tag in &tags {
            connection
                .execute(
                    "DELETE FROM tags WHERE path = ?1 AND tag = ?2 COLLATE NOCASE",
                    params![path, tag],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        results.push(TaggedPath {
            tags: tags_for_path_with(&connection, &path)?,
            path,
        });
    }
    Ok(results)
}

pub(crate) fn apply_internal_tag_action(path: &str, tags: &[String], context: &JobContext) -> Result<(), String> {
    add_tags_to_path(path, tags)?;
    context.progress(
        Some(1.0),
        Some(format!(
            "Tagged {}",
            Path::new(path)
                .file_name()
                .map(|value| value.to_string_lossy())
                .unwrap_or_default()
        )),
    );
    Ok(())
}

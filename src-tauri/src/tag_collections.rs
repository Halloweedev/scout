use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCollection {
    tag: String,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaggedCollectionItem {
    path: String,
    name: String,
    kind: String,
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

fn item_kind(path: &Path) -> String {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => "symlink".into(),
        Ok(metadata) if metadata.is_dir() => "directory".into(),
        Ok(metadata) if metadata.is_file() => "file".into(),
        _ => "other".into(),
    }
}

#[tauri::command]
pub fn tag_collections() -> Result<Vec<TagCollection>, String> {
    let connection = connection()?;
    let mut statement = connection
        .prepare("SELECT tag, path FROM tags ORDER BY lower(tag), tag, created_ms DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|error| error.to_string())?;

    let mut collections: BTreeMap<String, (String, HashSet<String>)> = BTreeMap::new();
    for row in rows {
        let (tag, path) = row.map_err(|error| error.to_string())?;
        if !Path::new(&path).exists() {
            continue;
        }
        let key = tag.to_lowercase();
        let entry = collections.entry(key).or_insert_with(|| (tag.clone(), HashSet::new()));
        entry.1.insert(path);
    }

    Ok(collections
        .into_values()
        .map(|(tag, paths)| TagCollection { tag, count: paths.len() })
        .filter(|collection| collection.count > 0)
        .collect())
}

#[tauri::command]
pub fn paths_for_tag(tag: String) -> Result<Vec<TaggedCollectionItem>, String> {
    let tag = tag.trim();
    if tag.is_empty() {
        return Err("Tag cannot be empty".into());
    }
    let connection = connection()?;
    let mut statement = connection
        .prepare(
            "SELECT path, MAX(created_ms) AS latest
             FROM tags
             WHERE tag = ?1 COLLATE NOCASE
             GROUP BY path
             ORDER BY latest DESC, lower(path)",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![tag], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        let path = row.map_err(|error| error.to_string())?;
        let path_buf = PathBuf::from(&path);
        if !path_buf.exists() {
            continue;
        }
        let name = path_buf
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        items.push(TaggedCollectionItem {
            kind: item_kind(&path_buf),
            path,
            name,
        });
    }
    Ok(items)
}

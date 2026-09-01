use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_HISTORY: usize = 100;

#[derive(Clone, Serialize, Deserialize)]
pub enum HistoryAction {
    Rename { from: String, to: String },
    CreateDirectory { path: String },
    Copy { pairs: Vec<(String, String)> },
    Move { pairs: Vec<(String, String)> },
}

#[derive(Clone, Serialize, Deserialize)]
pub struct StoredOperation {
    pub id: u64,
    pub kind: String,
    pub label: String,
    pub timestamp_ms: u64,
    pub action: HistoryAction,
}

#[derive(Clone, Serialize, Deserialize)]
struct HistoryStore {
    entries: Vec<StoredOperation>,
    cursor: usize,
    next_id: u64,
}

impl Default for HistoryStore {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            cursor: 0,
            next_id: 0,
        }
    }
}

pub struct HistoryState {
    inner: Mutex<HistoryStore>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    id: u64,
    kind: String,
    label: String,
    timestamp_ms: u64,
    applied: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySnapshot {
    entries: Vec<HistoryEntry>,
    can_undo: bool,
    can_redo: bool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn history_path() -> Option<PathBuf> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::home_dir)?;
    Some(base.join("Scout").join("footprints.json"))
}

fn normalize_store(store: &mut HistoryStore) {
    if store.entries.len() > MAX_HISTORY {
        let overflow = store.entries.len() - MAX_HISTORY;
        store.entries.drain(0..overflow);
        store.cursor = store.cursor.saturating_sub(overflow);
    }
    store.cursor = store.cursor.min(store.entries.len());
    if let Some(max_id) = store.entries.iter().map(|entry| entry.id).max() {
        store.next_id = store.next_id.max(max_id);
    }
}

fn load_store() -> HistoryStore {
    let Some(path) = history_path() else {
        return HistoryStore::default();
    };
    let Ok(bytes) = fs::read(path) else {
        return HistoryStore::default();
    };
    let Ok(mut store) = serde_json::from_slice::<HistoryStore>(&bytes) else {
        return HistoryStore::default();
    };
    normalize_store(&mut store);
    store
}

fn persist_store(store: &HistoryStore) -> Result<(), String> {
    let path = history_path().ok_or_else(|| "Scout could not determine a local history directory".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec(store).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|error| error.to_string())?;
    if let Err(rename_error) = fs::rename(&temp, &path) {
        let fallback = fs::read(&temp)
            .and_then(|bytes| fs::write(&path, bytes))
            .map_err(|error| format!("Could not persist Footprints: {rename_error}; fallback failed: {error}"));
        let _ = fs::remove_file(&temp);
        fallback?;
    }
    Ok(())
}

impl Default for HistoryState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(load_store()),
        }
    }
}

impl HistoryState {
    pub fn record(&self, kind: impl Into<String>, label: impl Into<String>, action: HistoryAction) {
        let snapshot = {
            let Ok(mut store) = self.inner.lock() else {
                return;
            };
            let cursor = store.cursor;
            store.entries.truncate(cursor);
            store.next_id = store.next_id.saturating_add(1);
            let operation = StoredOperation {
                id: store.next_id,
                kind: kind.into(),
                label: label.into(),
                timestamp_ms: now_ms(),
                action,
            };
            store.entries.push(operation);
            normalize_store(&mut store);
            store.cursor = store.entries.len();
            store.clone()
        };
        let _ = persist_store(&snapshot);
    }

    pub fn peek_undo(&self) -> Option<StoredOperation> {
        let store = self.inner.lock().ok()?;
        if store.cursor == 0 {
            None
        } else {
            store.entries.get(store.cursor - 1).cloned()
        }
    }

    pub fn peek_redo(&self) -> Option<StoredOperation> {
        let store = self.inner.lock().ok()?;
        store.entries.get(store.cursor).cloned()
    }

    pub fn commit_undo(&self, id: u64) -> Result<(), String> {
        let snapshot = {
            let mut store = self.inner.lock().map_err(|_| "Operation history is unavailable".to_string())?;
            if store.cursor == 0 || store.entries.get(store.cursor - 1).map(|entry| entry.id) != Some(id) {
                return Err("Operation history changed before undo completed".into());
            }
            store.cursor -= 1;
            store.clone()
        };
        let _ = persist_store(&snapshot);
        Ok(())
    }

    pub fn commit_redo(&self, id: u64) -> Result<(), String> {
        let snapshot = {
            let mut store = self.inner.lock().map_err(|_| "Operation history is unavailable".to_string())?;
            if store.entries.get(store.cursor).map(|entry| entry.id) != Some(id) {
                return Err("Operation history changed before redo completed".into());
            }
            store.cursor += 1;
            store.clone()
        };
        let _ = persist_store(&snapshot);
        Ok(())
    }

    pub fn snapshot(&self) -> Result<HistorySnapshot, String> {
        let store = self.inner.lock().map_err(|_| "Operation history is unavailable".to_string())?;
        let entries = store
            .entries
            .iter()
            .enumerate()
            .rev()
            .map(|(index, entry)| HistoryEntry {
                id: entry.id,
                kind: entry.kind.clone(),
                label: entry.label.clone(),
                timestamp_ms: entry.timestamp_ms,
                applied: index < store.cursor,
            })
            .collect();
        Ok(HistorySnapshot {
            entries,
            can_undo: store.cursor > 0,
            can_redo: store.cursor < store.entries.len(),
        })
    }
}

#[tauri::command]
pub fn operation_history(state: tauri::State<'_, HistoryState>) -> Result<HistorySnapshot, String> {
    state.snapshot()
}

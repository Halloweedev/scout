use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub enum HistoryAction {
    Rename { from: String, to: String },
    CreateDirectory { path: String },
    Copy { pairs: Vec<(String, String)> },
    Move { pairs: Vec<(String, String)> },
}

#[derive(Clone)]
pub struct StoredOperation {
    pub id: u64,
    pub kind: String,
    pub label: String,
    pub timestamp_ms: u64,
    pub action: HistoryAction,
}

#[derive(Default)]
struct HistoryStore {
    entries: Vec<StoredOperation>,
    cursor: usize,
    next_id: u64,
}

#[derive(Default)]
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

impl HistoryState {
    pub fn record(&self, kind: impl Into<String>, label: impl Into<String>, action: HistoryAction) {
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
        if store.entries.len() > 100 {
            let overflow = store.entries.len() - 100;
            store.entries.drain(0..overflow);
        }
        store.cursor = store.entries.len();
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
        let mut store = self.inner.lock().map_err(|_| "Operation history is unavailable".to_string())?;
        if store.cursor == 0 || store.entries.get(store.cursor - 1).map(|entry| entry.id) != Some(id) {
            return Err("Operation history changed before undo completed".into());
        }
        store.cursor -= 1;
        Ok(())
    }

    pub fn commit_redo(&self, id: u64) -> Result<(), String> {
        let mut store = self.inner.lock().map_err(|_| "Operation history is unavailable".to_string())?;
        if store.entries.get(store.cursor).map(|entry| entry.id) != Some(id) {
            return Err("Operation history changed before redo completed".into());
        }
        store.cursor += 1;
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

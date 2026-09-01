use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct WatchInner {
    path: Option<PathBuf>,
    watcher: Option<RecommendedWatcher>,
}

#[derive(Default)]
pub struct WatchState {
    inner: Mutex<WatchInner>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsChangeEvent {
    kind: String,
    paths: Vec<String>,
}

#[tauri::command]
pub fn watch_directory(
    app: AppHandle,
    state: State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.is_dir() {
        return Err(format!("Cannot watch a non-directory path: {}", target.display()));
    }

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Filesystem watcher state is unavailable".to_string())?;

    if inner.path.as_ref() == Some(&target) {
        return Ok(());
    }

    let event_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| match result {
        Ok(event) => {
            let payload = FsChangeEvent {
                kind: format!("{:?}", event.kind),
                paths: event
                    .paths
                    .into_iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
            };
            let _ = event_app.emit("scout-fs-change", payload);
        }
        Err(error) => {
            let _ = event_app.emit("scout-fs-watch-error", error.to_string());
        }
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&target, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    inner.path = Some(target);
    inner.watcher = Some(watcher);
    Ok(())
}

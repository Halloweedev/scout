use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_HISTORY: usize = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationJob {
    id: u64,
    kind: String,
    label: String,
    status: String,
    progress: Option<f64>,
    detail: Option<String>,
    error: Option<String>,
    result: Option<Value>,
    cancellable: bool,
    created_ms: u128,
    started_ms: Option<u128>,
    finished_ms: Option<u128>,
}

struct QueueInner {
    next_id: u64,
    jobs: VecDeque<OperationJob>,
}

pub struct OperationQueueState {
    inner: Mutex<QueueInner>,
    cancellations: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

impl Default for OperationQueueState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(QueueInner {
                next_id: 1,
                jobs: VecDeque::new(),
            }),
            cancellations: Mutex::new(HashMap::new()),
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

impl OperationQueueState {
    fn create_job(&self, kind: String, label: String) -> (u64, Arc<AtomicBool>) {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut inner = self.inner.lock().expect("operation queue mutex poisoned");
        let id = inner.next_id;
        inner.next_id = inner.next_id.saturating_add(1);
        inner.jobs.push_front(OperationJob {
            id,
            kind,
            label,
            status: "queued".to_string(),
            progress: Some(0.0),
            detail: None,
            error: None,
            result: None,
            cancellable: true,
            created_ms: now_ms(),
            started_ms: None,
            finished_ms: None,
        });
        while inner.jobs.len() > MAX_HISTORY {
            inner.jobs.pop_back();
        }
        drop(inner);
        self.cancellations
            .lock()
            .expect("operation queue cancellation mutex poisoned")
            .insert(id, cancel.clone());
        (id, cancel)
    }

    fn update<F>(&self, id: u64, update: F)
    where
        F: FnOnce(&mut OperationJob),
    {
        let mut inner = self.inner.lock().expect("operation queue mutex poisoned");
        if let Some(job) = inner.jobs.iter_mut().find(|job| job.id == id) {
            update(job);
        }
    }

    fn finish_cancel_tracking(&self, id: u64) {
        self.cancellations
            .lock()
            .expect("operation queue cancellation mutex poisoned")
            .remove(&id);
    }
}

#[derive(Clone)]
pub struct JobContext {
    id: u64,
    app: AppHandle,
    cancel: Arc<AtomicBool>,
}

impl JobContext {
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn progress(&self, progress: Option<f64>, detail: impl Into<Option<String>>) {
        let state = self.app.state::<OperationQueueState>();
        state.update(self.id, |job| {
            job.progress = progress.map(|value| value.clamp(0.0, 1.0));
            job.detail = detail.into();
        });
        let _ = self.app.emit("scout-operation-queue", self.id);
    }
}

pub fn enqueue_blocking<T, F>(app: AppHandle, kind: impl Into<String>, label: impl Into<String>, worker: F) -> u64
where
    T: Serialize + Send + 'static,
    F: FnOnce(JobContext) -> Result<T, String> + Send + 'static,
{
    let (id, cancel) = app
        .state::<OperationQueueState>()
        .create_job(kind.into(), label.into());
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_task.state::<OperationQueueState>();
        if cancel.load(Ordering::Relaxed) {
            state.update(id, |job| {
                job.status = "cancelled".to_string();
                job.progress = None;
                job.finished_ms = Some(now_ms());
            });
            state.finish_cancel_tracking(id);
            let _ = app_for_task.emit("scout-operation-queue", id);
            return;
        }

        state.update(id, |job| {
            job.status = "running".to_string();
            job.started_ms = Some(now_ms());
        });
        let _ = app_for_task.emit("scout-operation-queue", id);

        let context = JobContext {
            id,
            app: app_for_task.clone(),
            cancel: cancel.clone(),
        };
        let result = worker(context);
        let cancelled = cancel.load(Ordering::Relaxed);
        state.update(id, |job| {
            job.finished_ms = Some(now_ms());
            if cancelled {
                job.status = "cancelled".to_string();
                job.progress = None;
                job.detail = Some("Cancelled".to_string());
                return;
            }
            match result {
                Ok(value) => match serde_json::to_value(value) {
                    Ok(value) => {
                        job.status = "completed".to_string();
                        job.progress = Some(1.0);
                        job.result = Some(value);
                    }
                    Err(error) => {
                        job.status = "failed".to_string();
                        job.progress = None;
                        job.error = Some(error.to_string());
                    }
                },
                Err(error) => {
                    job.status = "failed".to_string();
                    job.progress = None;
                    job.error = Some(error);
                }
            }
        });
        state.finish_cancel_tracking(id);
        let _ = app_for_task.emit("scout-operation-queue", id);
    });
    let _ = app.emit("scout-operation-queue", id);
    id
}

#[tauri::command]
pub fn operation_queue(state: State<'_, OperationQueueState>) -> Vec<OperationJob> {
    state
        .inner
        .lock()
        .expect("operation queue mutex poisoned")
        .jobs
        .iter()
        .cloned()
        .collect()
}

#[tauri::command]
pub fn cancel_operation(id: u64, state: State<'_, OperationQueueState>) -> bool {
    let cancellation = state
        .cancellations
        .lock()
        .expect("operation queue cancellation mutex poisoned")
        .get(&id)
        .cloned();
    if let Some(cancellation) = cancellation {
        cancellation.store(true, Ordering::Relaxed);
        state.update(id, |job| {
            job.detail = Some("Cancelling…".to_string());
        });
        true
    } else {
        false
    }
}

#[tauri::command]
pub fn clear_finished_operations(state: State<'_, OperationQueueState>) {
    let mut inner = state.inner.lock().expect("operation queue mutex poisoned");
    inner.jobs.retain(|job| job.status == "queued" || job.status == "running");
}

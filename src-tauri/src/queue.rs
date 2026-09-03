use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, MutexGuard,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_HISTORY: usize = 100;
const MAX_CONCURRENT_JOBS: usize = 3;
const MAX_BACKGROUND_JOBS: usize = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum JobPriority {
    Foreground,
    Background,
}

impl JobPriority {
    fn as_str(self) -> &'static str {
        match self {
            Self::Foreground => "foreground",
            Self::Background => "background",
        }
    }
}

fn priority_for_kind(kind: &str) -> JobPriority {
    match kind {
        "duplicates" | "disk-map" | "similar-photos" | "file-health" | "index" | "automation" => {
            JobPriority::Background
        }
        _ => JobPriority::Foreground,
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationJob {
    id: u64,
    kind: String,
    label: String,
    priority: String,
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

#[derive(Default)]
struct SchedulerInner {
    foreground_waiters: VecDeque<u64>,
    background_waiters: VecDeque<u64>,
    active_total: usize,
    active_background: usize,
}

#[derive(Default)]
struct OperationScheduler {
    inner: Mutex<SchedulerInner>,
    wake: Condvar,
}

impl OperationScheduler {
    fn register(&self, id: u64, priority: JobPriority) {
        let mut inner = recover_lock(&self.inner);
        match priority {
            JobPriority::Foreground => inner.foreground_waiters.push_back(id),
            JobPriority::Background => inner.background_waiters.push_back(id),
        }
        self.wake.notify_all();
    }

    fn acquire(&self, id: u64, priority: JobPriority, cancel: &AtomicBool) -> bool {
        let mut inner = recover_lock(&self.inner);
        loop {
            if cancel.load(Ordering::Relaxed) {
                Self::remove_waiter(&mut inner, id, priority);
                self.wake.notify_all();
                return false;
            }

            let is_front = match priority {
                JobPriority::Foreground => inner.foreground_waiters.front().copied() == Some(id),
                JobPriority::Background => inner.background_waiters.front().copied() == Some(id),
            };
            let has_capacity = inner.active_total < MAX_CONCURRENT_JOBS;
            let priority_has_capacity = match priority {
                JobPriority::Foreground => true,
                JobPriority::Background => {
                    inner.active_background < MAX_BACKGROUND_JOBS
                        && inner.foreground_waiters.is_empty()
                }
            };

            if is_front && has_capacity && priority_has_capacity {
                match priority {
                    JobPriority::Foreground => {
                        inner.foreground_waiters.pop_front();
                    }
                    JobPriority::Background => {
                        inner.background_waiters.pop_front();
                        inner.active_background += 1;
                    }
                }
                inner.active_total += 1;
                return true;
            }

            let waited = self
                .wake
                .wait_timeout(inner, Duration::from_millis(100))
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner = waited.0;
        }
    }

    fn release(&self, priority: JobPriority) {
        let mut inner = recover_lock(&self.inner);
        inner.active_total = inner.active_total.saturating_sub(1);
        if priority == JobPriority::Background {
            inner.active_background = inner.active_background.saturating_sub(1);
        }
        self.wake.notify_all();
    }

    fn notify(&self) {
        self.wake.notify_all();
    }

    fn remove_waiter(inner: &mut SchedulerInner, id: u64, priority: JobPriority) {
        let queue = match priority {
            JobPriority::Foreground => &mut inner.foreground_waiters,
            JobPriority::Background => &mut inner.background_waiters,
        };
        if let Some(index) = queue.iter().position(|candidate| *candidate == id) {
            queue.remove(index);
        }
    }
}

pub struct OperationQueueState {
    inner: Mutex<QueueInner>,
    cancellations: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    scheduler: OperationScheduler,
}

impl Default for OperationQueueState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(QueueInner {
                next_id: 1,
                jobs: VecDeque::new(),
            }),
            cancellations: Mutex::new(HashMap::new()),
            scheduler: OperationScheduler::default(),
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "unknown panic".to_string()
    }
}

impl OperationQueueState {
    fn create_job(
        &self,
        kind: String,
        label: String,
        priority: JobPriority,
    ) -> (u64, Arc<AtomicBool>) {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut inner = recover_lock(&self.inner);
        let id = inner.next_id;
        inner.next_id = inner.next_id.saturating_add(1);
        inner.jobs.push_front(OperationJob {
            id,
            kind,
            label,
            priority: priority.as_str().to_string(),
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
        recover_lock(&self.cancellations).insert(id, cancel.clone());
        self.scheduler.register(id, priority);
        (id, cancel)
    }

    fn update<F>(&self, id: u64, update: F)
    where
        F: FnOnce(&mut OperationJob),
    {
        let mut inner = recover_lock(&self.inner);
        if let Some(job) = inner.jobs.iter_mut().find(|job| job.id == id) {
            update(job);
        }
    }

    fn finish_cancel_tracking(&self, id: u64) {
        recover_lock(&self.cancellations).remove(&id);
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
        {
            let state = self.app.state::<OperationQueueState>();
            state.update(self.id, |job| {
                job.progress = progress.map(|value| value.clamp(0.0, 1.0));
                job.detail = detail.into();
            });
        }
        let _ = self.app.emit("scout-operation-queue", self.id);
    }
}

pub fn enqueue_blocking<T, F>(
    app: AppHandle,
    kind: impl Into<String>,
    label: impl Into<String>,
    worker: F,
) -> u64
where
    T: Serialize + Send + 'static,
    F: FnOnce(JobContext) -> Result<T, String> + Send + 'static,
{
    let kind = kind.into();
    let priority = priority_for_kind(&kind);
    let (id, cancel) = {
        let state = app.state::<OperationQueueState>();
        state.create_job(kind, label.into(), priority)
    };
    let app_for_task = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let acquired = {
            let state = app_for_task.state::<OperationQueueState>();
            state.scheduler.acquire(id, priority, cancel.as_ref())
        };

        if !acquired {
            {
                let state = app_for_task.state::<OperationQueueState>();
                state.update(id, |job| {
                    job.status = "cancelled".to_string();
                    job.progress = None;
                    job.detail = Some("Cancelled before starting".to_string());
                    job.finished_ms = Some(now_ms());
                });
                state.finish_cancel_tracking(id);
            }
            let _ = app_for_task.emit("scout-operation-queue", id);
            return;
        }

        {
            let state = app_for_task.state::<OperationQueueState>();
            state.update(id, |job| {
                job.status = "running".to_string();
                job.started_ms = Some(now_ms());
            });
        }
        let _ = app_for_task.emit("scout-operation-queue", id);

        let context = JobContext {
            id,
            app: app_for_task.clone(),
            cancel: cancel.clone(),
        };
        let result = catch_unwind(AssertUnwindSafe(|| worker(context)));
        let cancelled = cancel.load(Ordering::Relaxed);

        {
            let state = app_for_task.state::<OperationQueueState>();
            state.update(id, move |job| {
                job.finished_ms = Some(now_ms());
                if cancelled {
                    job.status = "cancelled".to_string();
                    job.progress = None;
                    job.detail = Some("Cancelled".to_string());
                    return;
                }
                match result {
                    Ok(Ok(value)) => match serde_json::to_value(value) {
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
                    Ok(Err(error)) => {
                        job.status = "failed".to_string();
                        job.progress = None;
                        job.error = Some(error);
                    }
                    Err(payload) => {
                        job.status = "failed".to_string();
                        job.progress = None;
                        job.detail = Some("The operation stopped unexpectedly".to_string());
                        job.error = Some(format!(
                            "Operation panicked: {}",
                            panic_message(payload.as_ref())
                        ));
                    }
                }
            });
            state.finish_cancel_tracking(id);
            state.scheduler.release(priority);
        }
        let _ = app_for_task.emit("scout-operation-queue", id);
    });

    let _ = app.emit("scout-operation-queue", id);
    id
}

#[tauri::command]
pub fn operation_queue(state: State<'_, OperationQueueState>) -> Vec<OperationJob> {
    recover_lock(&state.inner).jobs.iter().cloned().collect()
}

#[tauri::command]
pub fn cancel_operation(id: u64, state: State<'_, OperationQueueState>) -> bool {
    let cancellation = recover_lock(&state.cancellations).get(&id).cloned();
    if let Some(cancellation) = cancellation {
        cancellation.store(true, Ordering::Relaxed);
        state.update(id, |job| {
            job.detail = Some("Cancelling…".to_string());
        });
        state.scheduler.notify();
        true
    } else {
        false
    }
}

#[tauri::command]
pub fn clear_finished_operations(state: State<'_, OperationQueueState>) {
    let mut inner = recover_lock(&state.inner);
    inner
        .jobs
        .retain(|job| job.status == "queued" || job.status == "running");
}

#[cfg(test)]
mod tests {
    use super::{panic_message, priority_for_kind, JobPriority};

    #[test]
    fn formats_string_panic_payloads() {
        let message = "boom".to_string();
        assert_eq!(panic_message(&message), "boom");
    }

    #[test]
    fn classifies_background_operation_kinds() {
        for kind in [
            "duplicates",
            "disk-map",
            "similar-photos",
            "file-health",
            "index",
            "automation",
        ] {
            assert_eq!(priority_for_kind(kind), JobPriority::Background, "{kind}");
        }
    }

    #[test]
    fn keeps_direct_user_operations_foreground() {
        for kind in ["archive", "checksum", "conversion", "image", "pdf", "custom-action"] {
            assert_eq!(priority_for_kind(kind), JobPriority::Foreground, "{kind}");
        }
    }
}

use crate::{fs as scout_fs, history::HistoryState, queue::{self, JobContext}};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

const MAX_RULES: usize = 100;
const PREVIEW_MATCH_LIMIT: usize = 200;
const RUN_MATCH_LIMIT: usize = 10_000;
const SCAN_LIMIT: usize = 250_000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AutomationAction {
    Move { destination: String },
    Copy { destination: String },
    Rename { template: String },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRule {
    id: u64,
    name: String,
    enabled: bool,
    folder: String,
    recursive: bool,
    extension: Option<String>,
    name_contains: Option<String>,
    kind: String,
    min_size: Option<u64>,
    max_size: Option<u64>,
    action: AutomationAction,
    created_ms: u64,
    updated_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRuleInput {
    id: Option<u64>,
    name: String,
    enabled: bool,
    folder: String,
    recursive: bool,
    extension: Option<String>,
    name_contains: Option<String>,
    kind: String,
    min_size: Option<u64>,
    max_size: Option<u64>,
    action: AutomationAction,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct RuleStore {
    rules: Vec<AutomationRule>,
    next_id: u64,
}

pub struct AutomationState {
    inner: Mutex<RuleStore>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationMatch {
    path: String,
    name: String,
    kind: String,
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPreview {
    scanned: usize,
    matches: Vec<AutomationMatch>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunResult {
    rule_id: u64,
    matched: usize,
    affected: usize,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn rules_path() -> Option<PathBuf> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::home_dir)?;
    Some(base.join("Scout").join("automation-rules.json"))
}

fn normalize_store(store: &mut RuleStore) {
    if store.rules.len() > MAX_RULES {
        let overflow = store.rules.len() - MAX_RULES;
        store.rules.drain(0..overflow);
    }
    if let Some(max_id) = store.rules.iter().map(|rule| rule.id).max() {
        store.next_id = store.next_id.max(max_id);
    }
}

fn load_store() -> RuleStore {
    let Some(path) = rules_path() else {
        return RuleStore::default();
    };
    let Ok(bytes) = fs::read(path) else {
        return RuleStore::default();
    };
    let Ok(mut store) = serde_json::from_slice::<RuleStore>(&bytes) else {
        return RuleStore::default();
    };
    normalize_store(&mut store);
    store
}

fn persist_store(store: &RuleStore) -> Result<(), String> {
    let path = rules_path().ok_or_else(|| "Scout could not determine an automation rules directory".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec(store).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|error| error.to_string())?;
    if let Err(rename_error) = fs::rename(&temp, &path) {
        let fallback = fs::read(&temp)
            .and_then(|bytes| fs::write(&path, bytes))
            .map_err(|error| format!("Could not persist automation rules: {rename_error}; fallback failed: {error}"));
        let _ = fs::remove_file(&temp);
        fallback?;
    }
    Ok(())
}

impl Default for AutomationState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(load_store()),
        }
    }
}

fn normalized_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_rule_input(mut input: AutomationRuleInput) -> Result<AutomationRuleInput, String> {
    input.name = input.name.trim().to_string();
    if input.name.is_empty() {
        return Err("Rule name cannot be empty".into());
    }
    input.folder = input.folder.trim().to_string();
    let folder = PathBuf::from(&input.folder);
    if !folder.is_dir() {
        return Err("Rule folder is not a directory".into());
    }
    input.extension = normalized_optional(input.extension)
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase());
    input.name_contains = normalized_optional(input.name_contains);
    input.kind = match input.kind.trim().to_ascii_lowercase().as_str() {
        "file" => "file".to_string(),
        "directory" => "directory".to_string(),
        _ => "any".to_string(),
    };
    if let (Some(min), Some(max)) = (input.min_size, input.max_size) {
        if min > max {
            return Err("Minimum size cannot exceed maximum size".into());
        }
    }
    match &mut input.action {
        AutomationAction::Move { destination } | AutomationAction::Copy { destination } => {
            *destination = destination.trim().to_string();
            let target = PathBuf::from(destination.as_str());
            if !target.is_dir() {
                return Err("Automation destination is not a directory".into());
            }
            if target == folder || target.starts_with(&folder) {
                return Err("Automation destination cannot be inside the watched folder".into());
            }
        }
        AutomationAction::Rename { template } => {
            *template = template.trim().to_string();
            if template.is_empty() {
                return Err("Rename template cannot be empty".into());
            }
            if template.contains('/') || template.contains('\\') {
                return Err("Rename template cannot contain path separators".into());
            }
        }
    }
    Ok(input)
}

fn rule_by_id(state: &AutomationState, id: u64) -> Result<AutomationRule, String> {
    let store = state.inner.lock().map_err(|_| "Automation rules are unavailable".to_string())?;
    store
        .rules
        .iter()
        .find(|rule| rule.id == id)
        .cloned()
        .ok_or_else(|| "Automation rule was not found".to_string())
}

fn entry_matches(rule: &AutomationRule, path: &Path, metadata: &fs::Metadata) -> bool {
    let kind = if metadata.is_file() {
        "file"
    } else if metadata.is_dir() {
        "directory"
    } else {
        "other"
    };
    if rule.kind != "any" && rule.kind != kind {
        return false;
    }
    if let Some(extension) = rule.extension.as_deref() {
        let actual = path
            .extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if actual != extension {
            return false;
        }
    }
    if let Some(needle) = rule.name_contains.as_deref() {
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !name.contains(&needle.to_ascii_lowercase()) {
            return false;
        }
    }
    if let Some(min_size) = rule.min_size {
        if !metadata.is_file() || metadata.len() < min_size {
            return false;
        }
    }
    if let Some(max_size) = rule.max_size {
        if !metadata.is_file() || metadata.len() > max_size {
            return false;
        }
    }
    true
}

fn scan_rule(rule: &AutomationRule, match_limit: usize, context: Option<&JobContext>) -> Result<AutomationPreview, String> {
    let root = PathBuf::from(&rule.folder);
    if !root.is_dir() {
        return Err("Rule folder is no longer available".into());
    }
    let walker = WalkDir::new(&root).follow_links(false).min_depth(1);
    let walker = if rule.recursive { walker } else { walker.max_depth(1) };
    let mut scanned = 0usize;
    let mut matches = Vec::new();
    let mut truncated = false;

    for entry in walker {
        if context.is_some_and(JobContext::cancelled) {
            return Err("Automation cancelled".into());
        }
        if scanned >= SCAN_LIMIT {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.file_type().is_symlink() {
            continue;
        }
        scanned += 1;
        if scanned % 500 == 0 {
            if let Some(context) = context {
                context.progress(None, Some(format!("Scanned {scanned} items · {} matched", matches.len())));
            }
        }
        let Ok(metadata) = entry.metadata() else { continue };
        if !entry_matches(rule, entry.path(), &metadata) {
            continue;
        }
        matches.push(AutomationMatch {
            path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            kind: if metadata.is_dir() { "directory".to_string() } else { "file".to_string() },
            size: metadata.is_file().then_some(metadata.len()),
        });
        if matches.len() >= match_limit {
            truncated = true;
            break;
        }
    }
    Ok(AutomationPreview { scanned, matches, truncated })
}

fn render_rename(path: &Path, template: &str, number: usize) -> Result<String, String> {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or_else(|| "Cannot rename this path".to_string())?;
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.clone());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let rendered = template
        .replace("{name}", &name)
        .replace("{stem}", &stem)
        .replace("{ext}", &extension)
        .replace("{n}", &number.to_string());
    if rendered.trim().is_empty() || rendered == "." || rendered == ".." {
        return Err("Rename template produced an invalid name".into());
    }
    if rendered.contains('/') || rendered.contains('\\') {
        return Err("Rename template produced a path separator".into());
    }
    Ok(rendered)
}

fn execute_rule(app: &AppHandle, rule: AutomationRule, context: JobContext) -> Result<AutomationRunResult, String> {
    context.progress(None, Some("Scanning rule folder…".to_string()));
    let preview = scan_rule(&rule, RUN_MATCH_LIMIT + 1, Some(&context))?;
    if preview.truncated || preview.matches.len() > RUN_MATCH_LIMIT {
        return Err("Rule matched too many items. Narrow the rule before running it.".into());
    }
    let matched = preview.matches.len();
    if matched == 0 {
        context.progress(Some(1.0), Some("No matching items".to_string()));
        return Ok(AutomationRunResult { rule_id: rule.id, matched: 0, affected: 0 });
    }

    let mut affected = 0usize;
    for (index, item) in preview.matches.into_iter().enumerate() {
        if context.cancelled() {
            return Err("Automation cancelled".into());
        }
        let history = app.state::<HistoryState>();
        match &rule.action {
            AutomationAction::Move { destination } => {
                scout_fs::move_entries(vec![item.path.clone()], destination.clone(), history)?;
            }
            AutomationAction::Copy { destination } => {
                scout_fs::copy_entries(vec![item.path.clone()], destination.clone(), history)?;
            }
            AutomationAction::Rename { template } => {
                let new_name = render_rename(Path::new(&item.path), template, index + 1)?;
                scout_fs::rename_entry(item.path.clone(), new_name, history)?;
            }
        }
        affected += 1;
        context.progress(
            Some(affected as f64 / matched as f64),
            Some(format!("Processed {affected}/{matched} matches")),
        );
    }
    Ok(AutomationRunResult { rule_id: rule.id, matched, affected })
}

#[tauri::command]
pub fn automation_rules(state: State<'_, AutomationState>) -> Result<Vec<AutomationRule>, String> {
    let store = state.inner.lock().map_err(|_| "Automation rules are unavailable".to_string())?;
    let mut rules = store.rules.clone();
    rules.sort_by(|left, right| right.updated_ms.cmp(&left.updated_ms));
    Ok(rules)
}

#[tauri::command]
pub fn save_automation_rule(input: AutomationRuleInput, state: State<'_, AutomationState>) -> Result<AutomationRule, String> {
    let input = validate_rule_input(input)?;
    let snapshot;
    let saved;
    {
        let mut store = state.inner.lock().map_err(|_| "Automation rules are unavailable".to_string())?;
        let now = now_ms();
        if let Some(id) = input.id {
            let existing = store
                .rules
                .iter_mut()
                .find(|rule| rule.id == id)
                .ok_or_else(|| "Automation rule was not found".to_string())?;
            existing.name = input.name;
            existing.enabled = input.enabled;
            existing.folder = input.folder;
            existing.recursive = input.recursive;
            existing.extension = input.extension;
            existing.name_contains = input.name_contains;
            existing.kind = input.kind;
            existing.min_size = input.min_size;
            existing.max_size = input.max_size;
            existing.action = input.action;
            existing.updated_ms = now;
            saved = existing.clone();
        } else {
            store.next_id = store.next_id.saturating_add(1);
            let rule = AutomationRule {
                id: store.next_id,
                name: input.name,
                enabled: input.enabled,
                folder: input.folder,
                recursive: input.recursive,
                extension: input.extension,
                name_contains: input.name_contains,
                kind: input.kind,
                min_size: input.min_size,
                max_size: input.max_size,
                action: input.action,
                created_ms: now,
                updated_ms: now,
            };
            store.rules.push(rule.clone());
            normalize_store(&mut store);
            saved = rule;
        }
        snapshot = store.clone();
    }
    persist_store(&snapshot)?;
    Ok(saved)
}

#[tauri::command]
pub fn delete_automation_rule(id: u64, state: State<'_, AutomationState>) -> Result<(), String> {
    let snapshot = {
        let mut store = state.inner.lock().map_err(|_| "Automation rules are unavailable".to_string())?;
        let before = store.rules.len();
        store.rules.retain(|rule| rule.id != id);
        if store.rules.len() == before {
            return Err("Automation rule was not found".into());
        }
        store.clone()
    };
    persist_store(&snapshot)
}

#[tauri::command]
pub fn set_automation_rule_enabled(id: u64, enabled: bool, state: State<'_, AutomationState>) -> Result<AutomationRule, String> {
    let snapshot;
    let updated;
    {
        let mut store = state.inner.lock().map_err(|_| "Automation rules are unavailable".to_string())?;
        let rule = store
            .rules
            .iter_mut()
            .find(|rule| rule.id == id)
            .ok_or_else(|| "Automation rule was not found".to_string())?;
        rule.enabled = enabled;
        rule.updated_ms = now_ms();
        updated = rule.clone();
        snapshot = store.clone();
    }
    persist_store(&snapshot)?;
    Ok(updated)
}

#[tauri::command]
pub async fn preview_automation_rule(id: u64, state: State<'_, AutomationState>) -> Result<AutomationPreview, String> {
    let rule = rule_by_id(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || scan_rule(&rule, PREVIEW_MATCH_LIMIT, None))
        .await
        .map_err(|error| format!("Automation preview task failed: {error}"))?
}

#[tauri::command]
pub fn enqueue_automation_rule(app: AppHandle, id: u64) -> Result<u64, String> {
    let rule = rule_by_id(&app.state::<AutomationState>(), id)?;
    let label = format!("Automation · {}", rule.name);
    let app_for_worker = app.clone();
    Ok(queue::enqueue_blocking(app, "automation", label, move |context| {
        execute_rule(&app_for_worker, rule, context)
    }))
}

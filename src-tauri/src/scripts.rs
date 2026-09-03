use crate::{queue::{self, JobContext}, tags};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use tauri::AppHandle;

pub(crate) const INTERNAL_TAG_PROGRAM: &str = "@scout/tag";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramRunResult {
    program: String,
    path: String,
}

fn render_argument(template: &str, item: &Path) -> String {
    let name = item
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = item
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.clone());
    let extension = item
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let folder = item
        .parent()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();

    template
        .replace("{path}", &item.to_string_lossy())
        .replace("{name}", &name)
        .replace("{stem}", &stem)
        .replace("{ext}", &extension)
        .replace("{folder}", &folder)
}

pub(crate) fn run_program_blocking(
    program: String,
    arguments: Vec<String>,
    working_directory: Option<String>,
    item_path: String,
    context: &JobContext,
) -> Result<ProgramRunResult, String> {
    let program = program.trim().to_string();
    if program.is_empty() {
        return Err("Program path cannot be empty".into());
    }
    if arguments.len() > 64 {
        return Err("Scout supports at most 64 program arguments".into());
    }
    if arguments.iter().any(|argument| argument.len() > 4096) {
        return Err("A program argument is too long".into());
    }

    let item = PathBuf::from(&item_path);
    if !item.exists() {
        return Err("Action item no longer exists".into());
    }

    if program == INTERNAL_TAG_PROGRAM {
        tags::apply_internal_tag_action(&item_path, &arguments, context)?;
        return Ok(ProgramRunResult {
            program,
            path: item_path,
        });
    }

    let rendered = arguments
        .iter()
        .map(|argument| render_argument(argument, &item))
        .collect::<Vec<_>>();

    let mut command = Command::new(&program);
    command.args(rendered);
    if let Some(directory) = working_directory
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let rendered_directory = render_argument(&directory, &item);
        let directory = PathBuf::from(rendered_directory);
        if !directory.is_dir() {
            return Err("Program working directory is not a directory".into());
        }
        command.current_dir(directory);
    }
    command.stdout(Stdio::null()).stderr(Stdio::null());
    let display_name = Path::new(&program)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| program.clone());
    context.progress(None, Some(format!("Running {display_name}…")));

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {program}: {error}"))?;
    loop {
        if context.cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Program execution cancelled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!("Program exited with {status}"));
                }
                return Ok(ProgramRunResult {
                    program,
                    path: item_path,
                });
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not monitor program: {error}"));
            }
        }
    }
}

#[tauri::command]
pub fn enqueue_program_action(
    app: AppHandle,
    label: String,
    program: String,
    arguments: Vec<String>,
    working_directory: Option<String>,
    paths: Vec<String>,
) -> Result<u64, String> {
    let label = label.trim().to_string();
    if label.is_empty() {
        return Err("Custom action name cannot be empty".into());
    }
    if paths.is_empty() {
        return Err("Choose at least one item for the custom action".into());
    }
    if paths.len() > 1_000 {
        return Err("A custom action can run on at most 1,000 items at once".into());
    }
    let program_check = program.trim();
    if program_check.is_empty() {
        return Err("Program path cannot be empty".into());
    }
    if program_check == INTERNAL_TAG_PROGRAM {
        return Err("This program identifier is reserved by Scout".into());
    }
    let job_label = format!("{label} · {} {}", paths.len(), if paths.len() == 1 { "item" } else { "items" });
    Ok(queue::enqueue_blocking(app, "custom-action", job_label, move |context| {
        let total = paths.len();
        let mut results = Vec::with_capacity(total);
        for (index, path) in paths.into_iter().enumerate() {
            if context.cancelled() {
                return Err("Custom action cancelled".into());
            }
            context.progress(
                Some(index as f64 / total as f64),
                Some(format!("Running {label} · {}/{}", index + 1, total)),
            );
            results.push(run_program_blocking(
                program.clone(),
                arguments.clone(),
                working_directory.clone(),
                path,
                &context,
            )?);
        }
        context.progress(Some(1.0), Some(format!("{label} complete")));
        Ok(results)
    }))
}

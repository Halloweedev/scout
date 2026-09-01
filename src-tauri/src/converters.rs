use crate::queue::{self, JobContext};
use serde::Serialize;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConverterCapabilities {
    ffmpeg: bool,
    pandoc: bool,
    libreoffice: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionResult {
    source: String,
    output: String,
    engine: String,
}

fn command_works(program: &str, version_arg: &str) -> bool {
    Command::new(program)
        .arg(version_arg)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn libreoffice_candidates() -> Vec<String> {
    let mut candidates = vec!["libreoffice".to_string(), "soffice".to_string()];
    #[cfg(target_os = "macos")]
    candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".to_string());
    #[cfg(target_os = "windows")]
    {
        if let Ok(program_files) = env::var("PROGRAMFILES") {
            candidates.push(format!("{program_files}\\LibreOffice\\program\\soffice.exe"));
        }
        if let Ok(program_files_x86) = env::var("PROGRAMFILES(X86)") {
            candidates.push(format!("{program_files_x86}\\LibreOffice\\program\\soffice.exe"));
        }
    }
    candidates
}

fn find_libreoffice() -> Option<String> {
    libreoffice_candidates()
        .into_iter()
        .find(|candidate| command_works(candidate, "--version"))
}

fn available_output(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let direct = directory.join(format!("{stem}.{extension}"));
    if !direct.exists() {
        return direct;
    }
    for number in 2..10_000 {
        let candidate = directory.join(format!("{stem} {number}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}.{extension}", std::process::id()))
}

fn source_stem(path: &Path) -> String {
    path.file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Converted".to_string())
}

fn source_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn conversion_label(engine: &str, path: &str, target: &str) -> String {
    format!("{engine} · {} → {}", source_name(path), target.to_ascii_uppercase())
}

fn run(mut command: Command, engine: &str, context: Option<&JobContext>) -> Result<(), String> {
    if let Some(context) = context {
        context.progress(None, Some(format!("Running {engine}…")));
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {engine}: {error}"))?;

    loop {
        if context.is_some_and(JobContext::cancelled) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{engine} conversion cancelled"));
        }

        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Could not collect {engine} output: {error}"))?;
                if output.status.success() {
                    return Ok(());
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let details = if !stderr.is_empty() { stderr } else { stdout };
                return Err(if details.is_empty() {
                    format!("{engine} exited with {}", output.status)
                } else {
                    format!("{engine}: {details}")
                });
            }
            Ok(None) => thread::sleep(Duration::from_millis(120)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not monitor {engine}: {error}"));
            }
        }
    }
}

fn media_args(target: &str) -> Result<Vec<&'static str>, String> {
    match target {
        "mp3" => Ok(vec!["-vn", "-codec:a", "libmp3lame", "-q:a", "2"]),
        "m4a" => Ok(vec!["-vn", "-c:a", "aac", "-b:a", "192k"]),
        "wav" => Ok(vec!["-vn"]),
        "mp4" => Ok(vec!["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-movflags", "+faststart"]),
        "webm" => Ok(vec!["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-c:a", "libopus"]),
        "gif" => Ok(vec![]),
        _ => Err("Unsupported FFmpeg target. Use mp3, m4a, wav, mp4, webm, or gif".into()),
    }
}

pub(crate) fn convert_media_blocking(
    path: String,
    destination: String,
    target: String,
    context: Option<&JobContext>,
) -> Result<ConversionResult, String> {
    if !command_works("ffmpeg", "-version") {
        return Err("FFmpeg is not installed or is not available in PATH".into());
    }
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("Media source is not a file".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Media destination is not a directory".into());
    }
    let target = target.trim().to_ascii_lowercase();
    let args = media_args(&target)?;
    let output = available_output(&destination, &source_stem(&source), &target);
    let mut command = Command::new("ffmpeg");
    command.args(["-hide_banner", "-loglevel", "error", "-i"]);
    command.arg(&source);
    command.args(args);
    command.arg(&output);
    if let Err(error) = run(command, "FFmpeg", context) {
        let _ = fs::remove_file(&output);
        return Err(error);
    }
    Ok(ConversionResult {
        source: path,
        output: output.to_string_lossy().into_owned(),
        engine: "FFmpeg".to_string(),
    })
}

pub(crate) fn convert_pandoc_blocking(
    path: String,
    destination: String,
    target: String,
    context: Option<&JobContext>,
) -> Result<ConversionResult, String> {
    if !command_works("pandoc", "--version") {
        return Err("Pandoc is not installed or is not available in PATH".into());
    }
    let allowed = ["md", "html", "docx", "odt", "rtf", "epub", "txt"];
    let target = target.trim().to_ascii_lowercase();
    if !allowed.contains(&target.as_str()) {
        return Err("Unsupported Pandoc target".into());
    }
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("Document source is not a file".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Document destination is not a directory".into());
    }
    let output = available_output(&destination, &source_stem(&source), &target);
    let mut command = Command::new("pandoc");
    command.arg(&source).arg("-o").arg(&output);
    if let Err(error) = run(command, "Pandoc", context) {
        let _ = fs::remove_file(&output);
        return Err(error);
    }
    Ok(ConversionResult {
        source: path,
        output: output.to_string_lossy().into_owned(),
        engine: "Pandoc".to_string(),
    })
}

pub(crate) fn convert_libreoffice_blocking(
    path: String,
    destination: String,
    target: String,
    context: Option<&JobContext>,
) -> Result<ConversionResult, String> {
    let program = find_libreoffice().ok_or_else(|| "LibreOffice is not installed or could not be found".to_string())?;
    let allowed = ["pdf", "docx", "odt", "xlsx", "csv", "pptx"];
    let target = target.trim().to_ascii_lowercase();
    if !allowed.contains(&target.as_str()) {
        return Err("Unsupported LibreOffice target".into());
    }
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("Document source is not a file".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Document destination is not a directory".into());
    }

    let temp = destination.join(format!(".scout-convert-{}", std::process::id()));
    if temp.exists() {
        let _ = fs::remove_dir_all(&temp);
    }
    fs::create_dir(&temp).map_err(|error| error.to_string())?;
    let mut command = Command::new(&program);
    command.args(["--headless", "--convert-to", &target, "--outdir"]);
    command.arg(&temp).arg(&source);
    if let Err(error) = run(command, "LibreOffice", context) {
        let _ = fs::remove_dir_all(&temp);
        return Err(error);
    }

    if context.is_some_and(JobContext::cancelled) {
        let _ = fs::remove_dir_all(&temp);
        return Err("LibreOffice conversion cancelled".into());
    }

    let generated = fs::read_dir(&temp)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "LibreOffice did not produce an output file".to_string())?;
    let extension = generated
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| target.clone());
    let output = available_output(&destination, &source_stem(&source), &extension);
    fs::rename(&generated, &output).map_err(|error| error.to_string())?;
    let _ = fs::remove_dir_all(&temp);
    Ok(ConversionResult {
        source: path,
        output: output.to_string_lossy().into_owned(),
        engine: "LibreOffice".to_string(),
    })
}

#[tauri::command]
pub fn converter_capabilities() -> ConverterCapabilities {
    ConverterCapabilities {
        ffmpeg: command_works("ffmpeg", "-version"),
        pandoc: command_works("pandoc", "--version"),
        libreoffice: find_libreoffice().is_some(),
    }
}

#[tauri::command]
pub async fn convert_media(path: String, destination: String, target: String) -> Result<ConversionResult, String> {
    tauri::async_runtime::spawn_blocking(move || convert_media_blocking(path, destination, target, None))
        .await
        .map_err(|error| format!("Media conversion task failed: {error}"))?
}

#[tauri::command]
pub async fn convert_with_pandoc(path: String, destination: String, target: String) -> Result<ConversionResult, String> {
    tauri::async_runtime::spawn_blocking(move || convert_pandoc_blocking(path, destination, target, None))
        .await
        .map_err(|error| format!("Pandoc conversion task failed: {error}"))?
}

#[tauri::command]
pub async fn convert_with_libreoffice(path: String, destination: String, target: String) -> Result<ConversionResult, String> {
    tauri::async_runtime::spawn_blocking(move || convert_libreoffice_blocking(path, destination, target, None))
        .await
        .map_err(|error| format!("LibreOffice conversion task failed: {error}"))?
}

#[tauri::command]
pub fn enqueue_media_conversion(app: AppHandle, path: String, destination: String, target: String) -> Result<u64, String> {
    let label = conversion_label("FFmpeg", &path, &target);
    Ok(queue::enqueue_blocking(app, "conversion", label, move |context| {
        convert_media_blocking(path, destination, target, Some(&context))
    }))
}

#[tauri::command]
pub fn enqueue_pandoc_conversion(app: AppHandle, path: String, destination: String, target: String) -> Result<u64, String> {
    let label = conversion_label("Pandoc", &path, &target);
    Ok(queue::enqueue_blocking(app, "conversion", label, move |context| {
        convert_pandoc_blocking(path, destination, target, Some(&context))
    }))
}

#[tauri::command]
pub fn enqueue_libreoffice_conversion(
    app: AppHandle,
    path: String,
    destination: String,
    target: String,
) -> Result<u64, String> {
    let label = conversion_label("LibreOffice", &path, &target);
    Ok(queue::enqueue_blocking(app, "conversion", label, move |context| {
        convert_libreoffice_blocking(path, destination, target, Some(&context))
    }))
}

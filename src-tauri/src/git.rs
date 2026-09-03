use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    path: String,
    status: String,
    staged: bool,
    modified: bool,
    untracked: bool,
    conflicted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryStatus {
    root: String,
    branch: String,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<GitFileStatus>,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn command_start(path: &Path) -> PathBuf {
    if path.is_dir() {
        return path.to_path_buf();
    }
    if path.exists() {
        return path.parent().unwrap_or(path).to_path_buf();
    }
    path.parent().unwrap_or(path).to_path_buf()
}

fn spawn_git(cwd: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "Git is not installed or is not available on PATH".to_string()
            } else {
                format!("Could not run Git: {error}")
            }
        })
}

fn command_text(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = spawn_git(cwd, args)?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!("Git command failed: git {}", args.join(" "))
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn repository_root(path: &Path) -> Result<Option<PathBuf>, String> {
    let start = command_start(path);
    let output = spawn_git(&start, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(value)))
}

fn relative_to_root(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(path_string)
        .map_err(|_| format!("{} is outside the Git repository", path.display()))
}

fn branch_name(root: &Path) -> Result<String, String> {
    let symbolic = spawn_git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    if symbolic.status.success() {
        let branch = String::from_utf8_lossy(&symbolic.stdout).trim().to_string();
        if !branch.is_empty() {
            return Ok(branch);
        }
    }
    let commit = command_text(root, &["rev-parse", "--short", "HEAD"])?;
    Ok(format!("detached@{commit}"))
}

fn upstream_name(root: &Path) -> Result<Option<String>, String> {
    let output = spawn_git(
        root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    )?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!value.is_empty()).then_some(value))
}

fn ahead_behind(root: &Path, upstream: Option<&str>) -> Result<(u32, u32), String> {
    let Some(upstream) = upstream else {
        return Ok((0, 0));
    };
    let range = format!("HEAD...{upstream}");
    let output = command_text(root, &["rev-list", "--left-right", "--count", &range])?;
    let mut values = output.split_whitespace();
    let ahead = values.next().and_then(|value| value.parse().ok()).unwrap_or(0);
    let behind = values.next().and_then(|value| value.parse().ok()).unwrap_or(0);
    Ok((ahead, behind))
}

fn is_conflicted(index: char, worktree: char) -> bool {
    index == 'U'
        || worktree == 'U'
        || matches!((index, worktree), ('A', 'A') | ('D', 'D'))
}

fn parse_porcelain(bytes: &[u8]) -> Vec<GitFileStatus> {
    let mut fields = bytes.split(|value| *value == 0).filter(|field| !field.is_empty());
    let mut files = Vec::new();

    while let Some(record) = fields.next() {
        if record.len() < 4 {
            continue;
        }
        let index = record[0] as char;
        let worktree = record[1] as char;
        let path = String::from_utf8_lossy(&record[3..]).into_owned();
        let renamed_or_copied = matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C');
        if renamed_or_copied {
            let _ = fields.next();
        }
        let untracked = index == '?' && worktree == '?';
        files.push(GitFileStatus {
            path,
            status: format!("{index}{worktree}"),
            staged: !matches!(index, ' ' | '?' | '!'),
            modified: !matches!(worktree, ' ' | '?' | '!'),
            untracked,
            conflicted: is_conflicted(index, worktree),
        });
    }

    files.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
    files
}

fn repository_status(root: &Path) -> Result<GitRepositoryStatus, String> {
    let branch = branch_name(root)?;
    let upstream = upstream_name(root)?;
    let (ahead, behind) = ahead_behind(root, upstream.as_deref())?;
    let output = spawn_git(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() { "Could not read Git status".into() } else { message });
    }
    Ok(GitRepositoryStatus {
        root: path_string(root),
        branch,
        upstream,
        ahead,
        behind,
        files: parse_porcelain(&output.stdout),
    })
}

fn root_for_paths(paths: &[String]) -> Result<PathBuf, String> {
    let first = paths.first().ok_or_else(|| "No files selected".to_string())?;
    let root = repository_root(Path::new(first))?.ok_or_else(|| "The selection is not inside a Git repository".to_string())?;
    for path in paths.iter().skip(1) {
        let other = repository_root(Path::new(path))?.ok_or_else(|| format!("{path} is not inside a Git repository"))?;
        if other != root {
            return Err("All selected files must belong to the same Git repository".into());
        }
    }
    Ok(root)
}

fn pathspecs(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    paths.iter()
        .map(|value| relative_to_root(root, Path::new(value)))
        .collect()
}

fn apply_paths(paths: Vec<String>, command: &[&str]) -> Result<(), String> {
    let root = root_for_paths(&paths)?;
    let specs = pathspecs(&root, &paths)?;
    let mut process = Command::new("git");
    process.arg("-C").arg(&root).args(command).arg("--");
    for spec in &specs {
        process.arg(spec);
    }
    let output = process.output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed or is not available on PATH".to_string()
        } else {
            format!("Could not run Git: {error}")
        }
    })?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() { "Git operation failed".into() } else { message });
    }
    Ok(())
}

#[tauri::command]
pub fn git_repository_status(path: String) -> Result<Option<GitRepositoryStatus>, String> {
    let Some(root) = repository_root(Path::new(&path))? else {
        return Ok(None);
    };
    repository_status(&root).map(Some)
}

#[tauri::command]
pub fn git_diff(path: String, staged: bool) -> Result<String, String> {
    let source = PathBuf::from(&path);
    let root = repository_root(&source)?.ok_or_else(|| "The selected item is not inside a Git repository".to_string())?;
    let spec = relative_to_root(&root, &source)?;
    let mut args = vec!["diff", "--no-ext-diff", "--no-color"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&spec);
    command_text(&root, &args)
}

#[tauri::command]
pub fn git_stage(paths: Vec<String>) -> Result<(), String> {
    apply_paths(paths, &["add"])
}

#[tauri::command]
pub fn git_unstage(paths: Vec<String>) -> Result<(), String> {
    apply_paths(paths, &["restore", "--staged"])
}

#[tauri::command]
pub fn git_discard(paths: Vec<String>) -> Result<(), String> {
    apply_paths(paths, &["restore", "--worktree"])
}

#[cfg(test)]
mod tests {
    use super::parse_porcelain;

    #[test]
    fn parses_staged_modified_untracked_and_renamed_status() {
        let data = b"M  src/main.rs\0 M README.md\0?? notes.txt\0R  new.txt\0old.txt\0";
        let files = parse_porcelain(data);
        assert_eq!(files.len(), 4);
        let staged = files.iter().find(|item| item.path == "src/main.rs").unwrap();
        assert!(staged.staged);
        assert!(!staged.modified);
        let modified = files.iter().find(|item| item.path == "README.md").unwrap();
        assert!(!modified.staged);
        assert!(modified.modified);
        let untracked = files.iter().find(|item| item.path == "notes.txt").unwrap();
        assert!(untracked.untracked);
        let renamed = files.iter().find(|item| item.path == "new.txt").unwrap();
        assert_eq!(renamed.status, "R ");
    }
}

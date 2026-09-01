use std::{path::PathBuf, process::Command};

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let directory = if path.is_dir() {
        path
    } else {
        path.parent()
            .map(PathBuf::from)
            .ok_or_else(|| "Could not resolve a terminal directory".to_string())?
    };
    if !directory.is_dir() {
        return Err("Terminal target is not a directory".into());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal"])
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("Could not open Terminal: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        if Command::new("wt.exe").arg("-d").arg(&directory).spawn().is_ok() {
            return Ok(());
        }
        Command::new("cmd.exe")
            .args(["/C", "start", "", "cmd.exe", "/K", "cd", "/D"])
            .arg(&directory)
            .spawn()
            .map_err(|error| format!("Could not open a terminal: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let attempts: &[(&str, &[&str])] = &[
            ("xdg-terminal-exec", &[]),
            ("kgx", &["--working-directory"]),
            ("gnome-terminal", &["--working-directory"]),
            ("konsole", &["--workdir"]),
            ("xfce4-terminal", &["--working-directory"]),
        ];
        for (program, args) in attempts {
            let mut command = Command::new(program);
            command.args(*args).arg(&directory);
            if command.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err("No supported terminal launcher was found".into());
    }

    #[allow(unreachable_code)]
    Err("Opening a terminal is not supported on this platform".into())
}

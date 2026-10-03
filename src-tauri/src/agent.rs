use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const RECORD_EVENT: &str = "agent://record";

const NODE_MIN_MAJOR: u32 = 22;
const NODE_ENV_OVERRIDE: &str = "AGENT_RUNBOOK_NODE";
const SCRIPT_ENV_OVERRIDE: &str = "AGENT_RUNBOOK_AGENT_SCRIPT";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct AgentProcess {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    ready: Mutex<bool>,
    error: Mutex<Option<String>>,
}

#[derive(Serialize, Clone)]
pub struct AgentStatus {
    running: bool,
    connected: bool,
    error: Option<String>,
}

#[tauri::command]
pub fn agent_status(state: State<'_, AgentProcess>) -> AgentStatus {
    let status = AgentStatus {
        running: state.child.lock().map(|guard| guard.is_some()).unwrap_or(false),
        connected: state.ready.lock().map(|guard| *guard).unwrap_or(false),
        error: state.error.lock().ok().and_then(|guard| guard.clone()),
    };
    debug_log(format!(
        "agent_status -> running={} connected={} error={:?}",
        status.running, status.connected, status.error
    ));
    status
}

#[tauri::command]
pub fn agent_request(state: State<'_, AgentProcess>, payload: serde_json::Value) -> Result<(), String> {
    debug_log(format!("agent_request <- {payload}"));
    let mut guard = state.stdin.lock().map_err(|error| error.to_string())?;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "agent sidecar is not running".to_string())?;

    let mut line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("failed to write to the agent sidecar: {error}"))
}

pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let node = match find_node() {
        Ok(node) => node,
        Err(message) => {
            fail(app, message);
            return Ok(());
        }
    };

    let script = match agent_script_path(app) {
        Ok(script) => script,
        Err(message) => {
            fail(app, message);
            return Ok(());
        }
    };

    let mut command = node_command(&node.0);
    command
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            fail(app, format!("failed to start {}: {error}", node.0.display()));
            return Ok(());
        }
    };

    debug_log(format!(
        "started {} {} with {}",
        node.0.display(),
        node.1,
        script.display()
    ));

    let stdin = child.stdin.take();
    if let Some(stdout) = child.stdout.take() {
        read_stdout(app.clone(), stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        forward_stderr(app.clone(), stderr);
    }

    clear_error(app);
    set_stdin(app, stdin);
    set_child(app, Some(child));

    watch_child(app.clone());
    Ok(())
}

pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    set_ready(app, false);
    take_stdin(app);
    let child = take_child(app);

    if let Some(mut child) = child {
        let deadline = Instant::now() + Duration::from_millis(800);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
                _ => break,
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn read_stdout<R: Runtime, S>(app: AppHandle<R>, stream: S)
where
    S: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let record: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(record) => record,
                Err(_) => {
                    let _ = app.emit(RECORD_EVENT, log_record("warn", trimmed));
                    continue;
                }
            };

            if record.get("type").and_then(|value| value.as_str()) == Some("ready") {
                set_ready(&app, true);
            }
            debug_log(format!("agent_record -> {record}"));
            let _ = app.emit(RECORD_EVENT, record);
        }
    });
}

fn forward_stderr<R: Runtime, S>(app: AppHandle<R>, stream: S)
where
    S: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                let _ = app.emit(RECORD_EVENT, log_record("info", trimmed));
            }
        }
    });
}

fn watch_child<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(150));

        let status = {
            let state = app.state::<AgentProcess>();
            let mut guard = match state.child.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            match guard.as_mut() {
                Some(child) => child.try_wait(),
                None => return,
            }
        };

        match status {
            Ok(None) => continue,
            Ok(Some(status)) => {
                let code = match status.code() {
                    Some(code) => code.to_string(),
                    None => "signal".to_string(),
                };
                shutdown(&app, format!("agent sidecar exited with code {code}"));
                return;
            }
            Err(error) => {
                shutdown(&app, format!("lost track of the agent sidecar: {error}"));
                return;
            }
        }
    });
}

fn shutdown<R: Runtime>(app: &AppHandle<R>, message: String) {
    set_ready(app, false);
    take_stdin(app);
    take_child(app);
    set_error(app, Some(message.clone()));
    debug_log(format!("agent_closed -> {message}"));
    let _ = app.emit(RECORD_EVENT, closed_record(&message));
}

fn fail<R: Runtime>(app: &AppHandle<R>, message: String) {
    set_error(app, Some(message.clone()));
    debug_log(format!("agent_failed -> {message}"));
    let _ = app.emit(RECORD_EVENT, closed_record(&message));
}

fn set_ready<R: Runtime>(app: &AppHandle<R>, ready: bool) {
    let state = app.state::<AgentProcess>();
    let mut guard = state.ready.lock().unwrap_or_else(|error| error.into_inner());
    *guard = ready;
}

fn set_error<R: Runtime>(app: &AppHandle<R>, message: Option<String>) {
    let state = app.state::<AgentProcess>();
    let mut guard = state.error.lock().unwrap_or_else(|error| error.into_inner());
    *guard = message;
}

fn clear_error<R: Runtime>(app: &AppHandle<R>) {
    set_error(app, None);
}

fn set_stdin<R: Runtime>(app: &AppHandle<R>, stdin: Option<ChildStdin>) {
    let state = app.state::<AgentProcess>();
    let mut guard = state.stdin.lock().unwrap_or_else(|error| error.into_inner());
    *guard = stdin;
}

fn take_stdin<R: Runtime>(app: &AppHandle<R>) -> Option<ChildStdin> {
    let state = app.state::<AgentProcess>();
    let mut guard = state.stdin.lock().unwrap_or_else(|error| error.into_inner());
    guard.take()
}

fn set_child<R: Runtime>(app: &AppHandle<R>, child: Option<Child>) {
    let state = app.state::<AgentProcess>();
    let mut guard = state.child.lock().unwrap_or_else(|error| error.into_inner());
    *guard = child;
}

fn take_child<R: Runtime>(app: &AppHandle<R>) -> Option<Child> {
    let state = app.state::<AgentProcess>();
    let mut guard = state.child.lock().unwrap_or_else(|error| error.into_inner());
    guard.take()
}

fn agent_script_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(override_path) = env::var_os(SCRIPT_ENV_OVERRIDE) {
        let path = PathBuf::from(override_path);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "{SCRIPT_ENV_OVERRIDE} points to a missing file: {}",
            path.display()
        ));
    }

    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("agent").join("index.mjs"));
    if let Some(bundled) = &bundled {
        if bundled.exists() {
            return Ok(bundled.clone());
        }
    }

    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("agent")
        .join("index.mjs");
    if repository.exists() {
        return Ok(repository);
    }

    Err(format!(
        "agent bundle not found, run `npm run sidecar:build` (looked in {} and {})",
        bundled.map(|path| path.display().to_string()).unwrap_or_else(|| "?".to_string()),
        repository.display()
    ))
}

fn find_node() -> Result<(PathBuf, String), String> {
    if let Some(explicit) = env::var_os(NODE_ENV_OVERRIDE) {
        let path = PathBuf::from(explicit);
        let Some(version) = node_version(&path) else {
            return Err(format!(
                "{NODE_ENV_OVERRIDE} points to {}, which is not a runnable node",
                path.display()
            ));
        };
        return match version_major(&version) {
            Some(major) if major >= NODE_MIN_MAJOR => Ok((path, version)),
            _ => Err(format!(
                "{NODE_ENV_OVERRIDE} points to {} {}, but node {NODE_MIN_MAJOR} or newer is required",
                path.display(),
                version
            )),
        };
    }

    let mut rejected = Vec::new();
    for candidate in node_candidates() {
        let Some(version) = node_version(&candidate) else {
            continue;
        };
        match version_major(&version) {
            Some(major) if major >= NODE_MIN_MAJOR => return Ok((candidate, version)),
            _ => rejected.push(format!("{} {}", version, candidate.display())),
        }
    }

    if rejected.is_empty() {
        Err(format!(
            "node {NODE_MIN_MAJOR} or newer was not found, install it or point {NODE_ENV_OVERRIDE} at a node binary"
        ))
    } else {
        Err(format!(
            "node {NODE_MIN_MAJOR} or newer is required, found only {}",
            rejected.join(", ")
        ))
    }
}

fn node_candidates() -> Vec<PathBuf> {
    let executable = if cfg!(windows) { "node.exe" } else { "node" };
    let mut candidates = Vec::new();

    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|dir| dir.join(executable)));
    }

    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from);

    if let Some(home) = &home {
        for relative in [
            ".volta/bin",
            ".local/share/fnm/aliases/default/bin",
            ".fnm/aliases/default/bin",
            ".asdf/shims",
            ".local/share/mise/shims",
            ".local/bin",
            "scoop/apps/nodejs/current",
        ] {
            candidates.push(home.join(relative).join(executable));
        }
        candidates.extend(versioned_candidates(
            &home.join(".nvm").join("versions").join("node"),
            "bin",
        ));
    }

    if let Some(appdata) = env::var_os("APPDATA") {
        candidates.extend(versioned_candidates(&PathBuf::from(appdata).join("nvm"), ""));
    }
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local).join("Volta").join("bin").join(executable));
        candidates.push(
            PathBuf::from(&local)
                .join("Programs")
                .join("nodejs")
                .join(executable),
        );
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = env::var_os(variable) {
            candidates.push(PathBuf::from(base).join("nodejs").join(executable));
        }
    }

    #[cfg(target_os = "macos")]
    candidates.extend(
        ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"]
            .iter()
            .map(|dir| Path::new(dir).join(executable)),
    );
    #[cfg(target_os = "linux")]
    candidates.extend(
        ["/usr/local/bin", "/usr/bin", "/snap/bin", "/opt/node/bin"]
            .iter()
            .map(|dir| Path::new(dir).join(executable)),
    );

    let mut seen = Vec::new();
    candidates.retain(|candidate| {
        let key = candidate.to_string_lossy().to_string();
        if seen.contains(&key) || !is_executable(candidate) {
            return false;
        }
        seen.push(key);
        true
    });
    candidates
}

fn versioned_candidates(base: &Path, suffix: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(base) else {
        return Vec::new();
    };

    let executable = if cfg!(windows) { "node.exe" } else { "node" };
    let mut versions: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    versions
        .into_iter()
        .map(|path| {
            if suffix.is_empty() {
                path.join(executable)
            } else {
                path.join(suffix).join(executable)
            }
        })
        .collect()
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn node_version(program: &Path) -> Option<String> {
    let output = node_command(program).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    version.starts_with('v').then_some(version)
}

fn version_major(version: &str) -> Option<u32> {
    version.trim_start_matches('v').split('.').next()?.parse().ok()
}

fn node_command(program: &Path) -> Command {
    let command = Command::new(program);
    #[cfg(windows)]
    let command = {
        use std::os::windows::process::CommandExt;
        let mut command = command;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };
    command
}

fn log_record(level: &str, message: &str) -> serde_json::Value {
    serde_json::json!({ "type": "log", "level": level, "message": message })
}

fn closed_record(reason: &str) -> serde_json::Value {
    serde_json::json!({ "type": "closed", "reason": reason })
}

fn debug_log(message: impl std::fmt::Display) {
    if env::var_os("AGENT_RUNBOOK_DEBUG").is_some() {
        eprintln!("[agent] {message}");
    }
}

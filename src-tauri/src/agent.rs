use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub const RECORD_EVENT: &str = "agent://record";

const SIDECAR: &str = "agent-runbook-agent";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Default)]
pub struct AgentProcess {
    child: Mutex<Option<Child>>,
    stream: Mutex<Option<TcpStream>>,
}

#[derive(Serialize, Clone)]
pub struct AgentStatus {
    running: bool,
    connected: bool,
}

#[tauri::command]
pub fn agent_status(state: State<'_, AgentProcess>) -> AgentStatus {
    let status = AgentStatus {
        running: state.child.lock().map(|guard| guard.is_some()).unwrap_or(false),
        connected: state.stream.lock().map(|guard| guard.is_some()).unwrap_or(false),
    };
    debug_log(format!("agent_status -> running={} connected={}", status.running, status.connected));
    status
}

#[tauri::command]
pub fn agent_request(state: State<'_, AgentProcess>, payload: serde_json::Value) -> Result<(), String> {
    debug_log(format!("agent_request <- {payload}"));
    let mut guard = state.stream.lock().map_err(|error| error.to_string())?;
    let stream = guard
        .as_mut()
        .ok_or_else(|| "agent sidecar is not connected yet".to_string())?;

    let mut line = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .map_err(|error| format!("failed to write to the agent sidecar: {error}"))
}

pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("failed to bind a loopback port for the agent sidecar: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let token = random_token();
    debug_log(format!("listening for the sidecar on 127.0.0.1:{port}"));

    let binary = sidecar_path()?;
    let mut child = Command::new(&binary)
        .env("AGENT_RUNBOOK_PORT", port.to_string())
        .env("AGENT_RUNBOOK_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start {}: {error}", binary.display()))?;

    if let Some(stdout) = child.stdout.take() {
        forward_output(app.clone(), stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        forward_output(app.clone(), stderr);
    }

    *app.state::<AgentProcess>()
        .child
        .lock()
        .map_err(|error| error.to_string())? = Some(child);

    let handle = app.clone();
    std::thread::spawn(move || match accept_sidecar(&listener) {
        Ok(stream) => read_records(handle, stream, token),
        Err(message) => {
            let _ = handle.emit(RECORD_EVENT, closed_record(&message));
        }
    });

    Ok(())
}

pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    set_stream(app, None);
    let child = app
        .state::<AgentProcess>()
        .child
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn set_stream<R: Runtime>(app: &AppHandle<R>, stream: Option<TcpStream>) {
    let state = app.state::<AgentProcess>();
    let mut guard = state.stream.lock().unwrap_or_else(|error| error.into_inner());
    *guard = stream;
}

fn read_records<R: Runtime>(app: AppHandle<R>, stream: TcpStream, token: String) {
    let reader_stream = match stream.try_clone() {
        Ok(clone) => clone,
        Err(error) => {
            let _ = app.emit(RECORD_EVENT, closed_record(&error.to_string()));
            return;
        }
    };
    let mut lines = BufReader::new(reader_stream).lines();

    let mut verified = false;
    while let Some(line) = lines.next() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                let _ = app.emit(RECORD_EVENT, closed_record(&error.to_string()));
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        let mut record: serde_json::Value = match serde_json::from_str(&line) {
            Ok(record) => record,
            Err(_) => {
                let _ = app.emit(RECORD_EVENT, log_record("warn", &line));
                continue;
            }
        };

        if !verified {
            if record.get("token").and_then(|value| value.as_str()) != Some(token.as_str()) {
                let _ = app.emit(
                    RECORD_EVENT,
                    closed_record("agent sidecar handshake failed, shutting it down"),
                );
                stop(&app);
                return;
            }
            verified = true;
            if let Some(object) = record.as_object_mut() {
                object.remove("token");
            }
            set_stream(&app, stream.try_clone().ok());
        }

        let _ = app.emit(RECORD_EVENT, record.clone());
        debug_log(format!("agent_record -> {record}"));
    }

    set_stream(&app, None);
    let _ = app.emit(
        RECORD_EVENT,
        closed_record("agent sidecar connection closed"),
    );
}

fn accept_sidecar(listener: &TcpListener) -> Result<TcpStream, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + CONNECT_TIMEOUT;

    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).map_err(|error| error.to_string())?;
                return Ok(stream);
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("timed out waiting for the agent sidecar to connect".to_string());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn forward_output<R: Runtime, S>(app: AppHandle<R>, stream: S)
where
    S: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                let _ = app.emit(RECORD_EVENT, log_record("info", line.trim()));
            }
        }
    });
}

fn sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "cannot locate the application directory".to_string())?;
    let name = if cfg!(windows) {
        format!("{SIDECAR}.exe")
    } else {
        SIDECAR.to_string()
    };
    let path = dir.join(name);

    if !path.exists() {
        return Err(format!(
            "agent sidecar binary not found at {}; run `npm run sidecar:build`",
            path.display()
        ));
    }

    Ok(path)
}

fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher, RandomState};

    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    let first = hasher.finish();
    let second = RandomState::new().build_hasher().finish();
    format!("{first:016x}{second:016x}")
}

fn log_record(level: &str, message: &str) -> serde_json::Value {
    serde_json::json!({ "type": "log", "level": level, "message": message })
}

fn closed_record(reason: &str) -> serde_json::Value {
    serde_json::json!({ "type": "closed", "reason": reason })
}

fn debug_log(message: impl std::fmt::Display) {
    if std::env::var_os("AGENT_RUNBOOK_DEBUG").is_some() {
        eprintln!("[agent] {message}");
    }
}

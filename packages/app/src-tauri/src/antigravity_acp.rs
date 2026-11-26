//! Host Google's official ACP stdio server for an interactive ReadAny chat.
use crate::{
    codex_app_server::{agent_history_path, agent_workspace},
    reading_mcp::{write_private_json, EmbeddedMcp},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex as AsyncMutex,
};
use uuid::Uuid;

const EVENT: &str = "readany-acp-ipc";
const HISTORY: &str = "antigravity-chat-history.json";
const SETTINGS: &str = r#"{"agentMode":"","toolPermission":"request-review","permissions":{"ask":["command(*)","read_file(*)","write_file(*)","unsandboxed(*)"]}}"#;

type Writer = Arc<AsyncMutex<ChildStdin>>;
type Pending = Arc<Mutex<HashMap<String, Vec<Value>>>>;

#[derive(Default)]
pub struct AcpHost(Mutex<Option<Process>>);

struct Process {
    id: Uuid,
    child: Child,
    reader: tauri::async_runtime::JoinHandle<()>,
    input: Writer,
    approvals: Pending,
    cwd: PathBuf,
    mcp: Option<Arc<EmbeddedMcp>>,
}

impl Drop for Process {
    fn drop(&mut self) {
        self.reader.abort();
        let _ = self.child.start_kill();
    }
}

pub fn stop(app: &AppHandle) {
    if let Some(host) = app.try_state::<AcpHost>() {
        if let Ok(mut process) = host.0.lock() {
            process.take();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Launch {
    reading_session_id: Uuid,
    book_id: Option<String>,
    tools: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    process_id: Uuid,
    cwd: PathBuf,
}

fn installed_agy(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("READANY_AGY_BIN").map(PathBuf::from) {
        return if path.is_absolute() && path.is_file() {
            Ok(path)
        } else {
            Err("READANY_AGY_BIN must be an absolute path to Antigravity CLI.".into())
        };
    }
    [
        app.path()
            .home_dir()
            .ok()
            .map(|home| home.join(".local/bin/agy")),
        Some(PathBuf::from("/opt/homebrew/bin/agy")),
        Some(PathBuf::from("/usr/local/bin/agy")),
        crate::readany_cli::command_from_path("agy"),
    ]
    .into_iter()
    .flatten()
    .find(|path| path.is_absolute() && path.is_file())
    .ok_or_else(|| "Install and sign in to the official Antigravity CLI before connecting.".into())
}

#[tauri::command]
pub async fn readany_acp_open(
    window: WebviewWindow,
    launch: Launch,
    host: tauri::State<'_, AcpHost>,
) -> Result<HostInfo, String> {
    let app = window.app_handle();
    if window.label() != "main" || !crate::mlx::is_development_build(app) {
        return Err("Antigravity is only available in the Mac MLX development build.".into());
    }
    let mut slot = host.0.lock().map_err(|_| "ACP host is unavailable.")?;
    if slot.is_some() {
        return Err("Close the active Antigravity connection first.".into());
    }
    let binary = installed_agy(app)?;
    let cwd = agent_workspace(app, "desktop-antigravity", launch.reading_session_id)?;
    let mcp = launch
        .book_id
        .map(|book| {
            EmbeddedMcp::start(app, launch.tools, book, launch.reading_session_id).map(Arc::new)
        })
        .transpose()?;

    let mut command = Command::new(binary);
    command
        .current_dir(&cwd)
        .args([
            "--settings",
            SETTINGS,
            "acp",
            "--sandbox",
            "--process-per-session",
            "--include-default-customizations=false",
            "--disable-telemetry",
            "--cli_dir_name",
            "readany-acp",
            "--log-file",
            "/dev/null",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|err| format!("Could not start Antigravity: {err}"))?;
    let input = Arc::new(AsyncMutex::new(
        child.stdin.take().ok_or("ACP stdin is unavailable.")?,
    ));
    let stdout = child.stdout.take().ok_or("ACP stdout is unavailable.")?;
    let approvals: Pending = Arc::default();
    let id = Uuid::new_v4();
    let reader = tauri::async_runtime::spawn(read_output(
        window,
        id,
        stdout,
        input.clone(),
        approvals.clone(),
        mcp.as_ref().map(|lease| lease.token.clone()),
    ));
    *slot = Some(Process {
        id,
        child,
        reader,
        input,
        approvals,
        cwd: cwd.clone(),
        mcp,
    });
    Ok(HostInfo {
        process_id: id,
        cwd,
    })
}

async fn read_output(
    window: WebviewWindow,
    process_id: Uuid,
    stdout: ChildStdout,
    input: Writer,
    approvals: Pending,
    token: Option<String>,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let safe = token
            .as_ref()
            .map(|token| line.replace(token, "[redacted]"));
        let Ok(packet) = serde_json::from_str::<Value>(safe.as_deref().unwrap_or(&line)) else {
            break;
        };
        if let (Some(method), Some(id)) = (packet["method"].as_str(), packet.get("id")) {
            if method == "session/request_permission" {
                if let Some(options) = packet["params"]["options"].as_array() {
                    if let Ok(mut pending) = approvals.lock() {
                        pending.insert(id.to_string(), options.clone());
                    }
                }
            } else {
                // ReadAny advertises neither filesystem nor terminal client methods.
                if send(
                    &input,
                    json!({"jsonrpc":"2.0","id":id,"error":{
                        "code":-32601,"message":"Unsupported ACP client request"
                    }}),
                )
                .await
                .is_err()
                {
                    break;
                }
                continue;
            }
        }
        if window
            .emit(EVENT, json!({"processId":process_id,"packet":packet}))
            .is_err()
        {
            break;
        }
    }
    let _ = window.emit(EVENT, json!({"processId":process_id,"closed":true}));
}

async fn send(input: &Writer, value: Value) -> Result<(), String> {
    let mut encoded = serde_json::to_vec(&value).map_err(|_| "Invalid ACP message.")?;
    encoded.push(b'\n');
    tokio::time::timeout(Duration::from_secs(5), async {
        input.lock().await.write_all(&encoded).await
    })
    .await
    .map_err(|_| "Writing to Antigravity timed out.")?
    .map_err(|_| "Antigravity disconnected.".into())
}

fn prepare_request(
    packet: Value,
    cwd: &std::path::Path,
    lease: Option<&EmbeddedMcp>,
) -> Result<Value, String> {
    let method = packet["method"]
        .as_str()
        .ok_or("Expected an ACP request.")?;
    let params = &packet["params"];
    let id = &packet["id"];
    if method != "session/cancel" && !id.is_u64() {
        return Err("Expected an ACP request ID.".into());
    }
    let safe = match method {
        "initialize" => json!({
            "protocolVersion":1, "clientCapabilities":{},
            "clientInfo":{"name":"readany","title":"ReadAny","version":env!("CARGO_PKG_VERSION")}
        }),
        "session/new" | "session/load" | "session/resume" => {
            let servers: Vec<Value> = lease.map(|scope| json!({
                "type":"http","name":"readany_book","url":scope.url,
                "headers":[{"name":"Authorization","value":format!("Bearer {}",scope.token)}]
            })).into_iter().collect();
            let mut input = json!({"cwd":cwd,"mcpServers":servers});
            if method != "session/new" {
                input["sessionId"] = json!(session_id(params)?);
            }
            input
        }
        "session/prompt" => {
            let text = params["prompt"]
                .as_array()
                .filter(|blocks| blocks.len() == 1 && blocks[0]["type"] == "text")
                .and_then(|blocks| blocks[0]["text"].as_str())
                .filter(|text| !text.trim().is_empty())
                .ok_or("ReadAny ACP accepts one text prompt.")?;
            json!({"sessionId":session_id(params)?,"prompt":[{"type":"text","text":text}]})
        }
        "session/set_config_option" => {
            let config = params["configId"]
                .as_str()
                .ok_or("Missing ACP config ID.")?;
            let value = params["value"]
                .as_str()
                .ok_or("Missing ACP config value.")?;
            let allowed = match config {
                "model" => value.to_ascii_lowercase().starts_with("gemini-"),
                "mode" => matches!(value, "default" | "plan"),
                "thought_level" => !value.is_empty(),
                _ => false,
            };
            if !allowed {
                return Err("Unsupported Antigravity configuration choice.".into());
            }
            json!({"sessionId":session_id(params)?,"configId":config,"value":value})
        }
        "session/cancel" | "session/close" => json!({"sessionId":session_id(params)?}),
        _ => return Err("Unsupported ACP request.".into()),
    };
    let mut outgoing = json!({"jsonrpc":"2.0","method":method,"params":safe});
    if method != "session/cancel" {
        outgoing["id"] = id.clone();
    }
    Ok(outgoing)
}

fn session_id(params: &Value) -> Result<&str, String> {
    params["sessionId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("Missing ACP session ID.".into())
}

fn current(slot: &Option<Process>, id: Uuid) -> Result<&Process, String> {
    slot.as_ref()
        .filter(|p| p.id == id)
        .ok_or("Antigravity is no longer active.".into())
}

#[tauri::command]
pub async fn readany_acp_send(
    host: tauri::State<'_, AcpHost>,
    process_id: Uuid,
    packet: Value,
) -> Result<(), String> {
    let (input, request) = {
        let slot = host.0.lock().map_err(|_| "ACP host is unavailable.")?;
        let process = current(&slot, process_id)?;
        let request = prepare_request(packet, &process.cwd, process.mcp.as_deref())?;
        (process.input.clone(), request)
    };
    send(&input, request).await
}

fn permission_outcome(decision: &str, options: &[Value]) -> Value {
    let kind = match decision {
        "allow" => Some("allow_once"),
        "deny" => Some("reject_once"),
        _ => None,
    };
    let id = kind.and_then(|kind| {
        options
            .iter()
            .find(|opt| opt["kind"].as_str() == Some(kind))
            .and_then(|opt| opt["optionId"].as_str())
    });
    match id {
        Some(id) => json!({"outcome":"selected","optionId":id}),
        None => json!({"outcome":"cancelled"}),
    }
}

#[tauri::command]
pub async fn readany_acp_approve(
    host: tauri::State<'_, AcpHost>,
    process_id: Uuid,
    request_id: Value,
    decision: String,
) -> Result<(), String> {
    if !matches!(decision.as_str(), "allow" | "deny" | "cancel") {
        return Err("Invalid approval decision.".into());
    }
    let (input, options) = {
        let slot = host.0.lock().map_err(|_| "ACP host is unavailable.")?;
        let process = current(&slot, process_id)?;
        let options = process
            .approvals
            .lock()
            .map_err(|_| "ACP approvals unavailable.")?
            .remove(&request_id.to_string())
            .ok_or("This ACP approval is no longer pending.")?;
        (process.input.clone(), options)
    };
    let outcome = permission_outcome(&decision, &options);
    send(
        &input,
        json!({"jsonrpc":"2.0","id":request_id,"result":{"outcome":outcome}}),
    )
    .await
}

#[tauri::command]
pub async fn readany_acp_evidence(
    host: tauri::State<'_, AcpHost>,
    process_id: Uuid,
    evidence_id: String,
) -> Result<Value, String> {
    let lease = {
        let slot = host.0.lock().map_err(|_| "ACP host is unavailable.")?;
        current(&slot, process_id)?
            .mcp
            .clone()
            .ok_or("No authorized ReadAny book.")?
    };
    lease.evidence(evidence_id).await
}

#[tauri::command]
pub fn readany_acp_close(host: tauri::State<'_, AcpHost>, process_id: Uuid) {
    if let Ok(mut slot) = host.0.lock() {
        if current(&slot, process_id).is_ok() {
            slot.take();
        }
    }
}

#[tauri::command]
pub fn readany_acp_history_load(window: WebviewWindow) -> Result<Vec<Value>, String> {
    let path = agent_history_path(&window, HISTORY)?;
    match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Invalid Antigravity history.".into())
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(_) => Err("Could not read Antigravity history.".into()),
    }
}

#[tauri::command]
pub fn readany_acp_history_save(window: WebviewWindow, history: Vec<Value>) -> Result<(), String> {
    write_private_json(&agent_history_path(&window, HISTORY)?, &history)
        .map_err(|_| "Could not save Antigravity history.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_untrusted_transport_and_client_capabilities() {
        let cwd = std::path::Path::new("/tmp/readany");
        let rpc = |method, params| {
            prepare_request(json!({"id":1,"method":method,"params":params}), cwd, None).unwrap()
        };
        assert_eq!(
            rpc(
                "session/new",
                json!({"cwd":"/private","mcpServers":[{}],"_meta":{"injected":1}})
            )["params"],
            json!({"cwd":"/tmp/readany","mcpServers":[]})
        );
        assert_eq!(
            rpc(
                "initialize",
                json!({"clientCapabilities":{"terminal":true}})
            )["params"]["clientCapabilities"],
            json!({})
        );
    }

    #[test]
    fn approval_uses_only_server_issued_single_use_choices() {
        let options = vec![
            json!({"kind":"allow_always","optionId":"never"}),
            json!({"kind":"allow_once","optionId":"once"}),
        ];
        assert_eq!(
            permission_outcome("allow", &options),
            json!({"outcome":"selected","optionId":"once"})
        );
        assert_eq!(
            permission_outcome("deny", &options),
            json!({"outcome":"cancelled"})
        );
    }
}

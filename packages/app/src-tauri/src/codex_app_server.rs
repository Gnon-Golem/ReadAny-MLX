//! Host one ReadAny conversation in the installed Codex App Server.
use crate::reading_mcp::EmbeddedMcp;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex as AsyncMutex,
};
use uuid::Uuid;

const EVENT: &str = "readany-codex-ipc";
const TOKEN_ENV: &str = "READANY_CODEX_MCP_TOKEN";
const BOOK_INSTRUCTIONS: &str = "You are in ReadAny. Use the ReadAny MCP to read the one authorized book. Cite only evidence IDs issued by its tools, using [[book-1]] style marks. Use native web search for public web information. Keep book excerpts and private reading context out of web queries. Never substitute shell/file access for reading the user's library. Ask before using local commands unless the user already explicitly requested that action in this turn.";
const GENERAL_INSTRUCTIONS: &str = "You are in the ReadAny chat. Use native web search for public web information. No book has been authorized for this conversation.";

#[derive(Default)]
pub struct CodexHost(Mutex<Option<Process>>, AsyncMutex<()>);

#[derive(Clone, Copy)]
enum Approval {
    Command,
    File,
    Permissions,
}

impl Approval {
    fn from_method(value: &str) -> Option<Self> {
        match value {
            "item/commandExecution/requestApproval" => Some(Self::Command),
            "item/fileChange/requestApproval" => Some(Self::File),
            "item/permissions/requestApproval" => Some(Self::Permissions),
            _ => None,
        }
    }

    fn response(self, decision: &str, params: &Value) -> Value {
        match self {
            Self::Permissions => json!({
                "scope": "turn",
                "permissions": if decision == "allow" && params["permissions"].is_object() {
                    params["permissions"].clone()
                } else {
                    json!({})
                }
            }),
            _ => json!({"decision": match decision {
                "allow" => "accept",
                "cancel" => "cancel",
                _ => "decline",
            }}),
        }
    }
}

type Approvals = Arc<Mutex<HashMap<String, (Approval, Value)>>>;

struct Process {
    id: Uuid,
    _child: Child,
    reader: tauri::async_runtime::JoinHandle<()>,
    input: Arc<AsyncMutex<ChildStdin>>,
    approvals: Approvals,
    cwd: PathBuf,
    mcp: Option<Arc<EmbeddedMcp>>,
}

impl Drop for Process {
    fn drop(&mut self) {
        self.reader.abort();
        let _ = self._child.start_kill();
    }
}

pub fn stop(app: &AppHandle) {
    if let Some(host) = app.try_state::<CodexHost>() {
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

fn installed_codex(app: &AppHandle) -> Result<PathBuf, String> {
    let explicit = std::env::var_os("READANY_CODEX_BIN").map(PathBuf::from);
    if let Some(explicit) = explicit {
        return if explicit.is_absolute() && explicit.is_file() {
            Ok(explicit)
        } else {
            Err("READANY_CODEX_BIN must name an installed Codex executable.".into())
        };
    }
    let candidates = [
        app.path()
            .home_dir()
            .ok()
            .map(|home| home.join(".local/bin/codex")),
        Some(PathBuf::from("/opt/homebrew/bin/codex")),
        Some(PathBuf::from("/usr/local/bin/codex")),
        crate::readany_cli::command_from_path("codex"),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_absolute() && path.is_file())
        .ok_or("Install the Codex CLI and sign in before starting a Codex chat.".into())
}

pub(crate) fn agent_workspace(
    app: &AppHandle,
    root_name: &str,
    id: Uuid,
) -> Result<PathBuf, String> {
    use std::os::unix::fs::DirBuilderExt;
    let root = crate::storage::default_data_root(app)?.join(root_name);
    let path = root.join(id.to_string());
    for dir in [&root, &path] {
        match std::fs::DirBuilder::new().mode(0o700).create(dir) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(err) => return Err(err.to_string()),
        }
        if !std::fs::symlink_metadata(dir)
            .map_err(|err| err.to_string())?
            .is_dir()
        {
            return Err("Codex workspace is not a directory.".into());
        }
    }
    Ok(path)
}

type ServerOutput = Lines<BufReader<ChildStdout>>;

fn app_server(binary: &Path, cwd: &Path) -> Command {
    let mut command = Command::new(binary);
    command
        .current_dir(cwd)
        .args([
            "app-server",
            "--listen",
            "stdio://",
            "--disable",
            "apps",
            "--disable",
            "plugins",
            "--disable",
            "memories",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .env_remove(TOKEN_ENV)
        .kill_on_drop(true);
    command
}

fn pipes(child: &mut Child) -> Result<(ChildStdin, ServerOutput), String> {
    let input = child.stdin.take().ok_or("Codex stdin is unavailable.")?;
    let output = child.stdout.take().ok_or("Codex stdout is unavailable.")?;
    Ok((input, BufReader::new(output).lines()))
}

async fn inspect_mcp_config(
    input: &mut ChildStdin,
    output: &mut ServerOutput,
) -> Result<Vec<String>, String> {
    async fn write(input: &mut ChildStdin, value: Value) -> Result<(), String> {
        let mut packet = serde_json::to_vec(&value).map_err(|err| err.to_string())?;
        packet.push(b'\n');
        input
            .write_all(&packet)
            .await
            .map_err(|_| "Codex App Server closed during startup.".into())
    }
    async fn reply(output: &mut ServerOutput, id: i32) -> Result<Value, String> {
        while let Some(line) = output
            .next_line()
            .await
            .map_err(|_| "Could not read Codex startup reply.")?
        {
            let packet: Value =
                serde_json::from_str(&line).map_err(|_| "Invalid Codex startup reply.")?;
            if packet["id"] == id {
                return if packet.get("error").is_some() {
                    Err("Codex rejected the startup or configuration request.".into())
                } else {
                    Ok(packet["result"].clone())
                };
            }
        }
        Err("Codex App Server exited during startup.".into())
    }

    tokio::time::timeout(Duration::from_secs(15), async {
        write(input, json!({"id":-1,"method":"initialize","params":{"clientInfo":{"name":"readany","title":"ReadAny","version":"1.3.7"}}})).await?;
        reply(output, -1).await?;
        write(input, json!({"method":"initialized"})).await?;
        write(input, json!({"id":-2,"method":"config/read","params":{"includeLayers":false}})).await?;
        let config = reply(output, -2).await?;
        let servers = config["config"]["mcp_servers"].as_object().ok_or("Codex did not expose its MCP configuration.")?;
        Ok(servers.iter().filter(|(_, settings)| settings["enabled"] != false).map(|(name, _)| name.clone()).collect())
    })
    .await.map_err(|_| "Codex startup or MCP configuration check timed out.".to_string())?
}

#[tauri::command]
pub async fn readany_codex_open(
    window: WebviewWindow,
    launch: Launch,
    host: tauri::State<'_, CodexHost>,
) -> Result<HostInfo, String> {
    let app = window.app_handle();
    if window.label() != "main" || !crate::mlx::is_development_build(app) {
        return Err("Codex chat is only available in the Mac MLX development build.".into());
    }
    let _launch = host.1.lock().await;
    if host
        .0
        .lock()
        .map_err(|_| "Codex host is unavailable.")?
        .is_some()
    {
        return Err("Close the active Codex chat first.".into());
    }
    let binary = installed_codex(app)?;
    let cwd = agent_workspace(app, "desktop-codex", launch.reading_session_id)?;

    // Config tables are merged by Codex. Disable each enabled inherited server
    // before starting the chat host, then verify the resulting effective table.
    let inherited = {
        let mut probe = app_server(&binary, &cwd)
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("Could not start Codex App Server: {err}"))?;
        let (mut input, mut output) = pipes(&mut probe)?;
        inspect_mcp_config(&mut input, &mut output).await?
    };
    let mcp = launch
        .book_id
        .map(|book| {
            EmbeddedMcp::start(app, launch.tools, book, launch.reading_session_id).map(Arc::new)
        })
        .transpose()?;
    let mut command = app_server(&binary, &cwd);
    for name in inherited {
        if name.is_empty()
            || !name
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_'))
        {
            return Err("ReadAny could not isolate an inherited Codex MCP server name.".into());
        }
        command
            .arg("-c")
            .arg(format!("mcp_servers.{name}.enabled=false"));
    }
    for setting in [
        "model_provider=\"openai\"",
        "web_search=\"live\"",
        "approval_policy=\"on-request\"",
        "approvals_reviewer=\"user\"",
        "sandbox_mode=\"read-only\"",
        "shell_environment_policy={inherit=\"core\",exclude=[\"READANY_CODEX_MCP_TOKEN\"]}",
    ] {
        command.args(["-c", setting]);
    }
    let granted_name = if let Some(lease) = &mcp {
        let name = format!("readany_book_{}", Uuid::new_v4().simple());
        command.arg("-c").arg(format!(
            "mcp_servers.{name}={{url=\"{}\",bearer_token_env_var=\"{}\",required=true,tool_timeout_sec=55}}",
            lease.url, TOKEN_ENV
        )).env(TOKEN_ENV, &lease.token);
        Some(name)
    } else {
        None
    };
    let mut child = command
        .spawn()
        .map_err(|err| format!("Could not start Codex App Server: {err}"))?;
    let (mut stdin, mut stdout) = pipes(&mut child)?;
    let effective = inspect_mcp_config(&mut stdin, &mut stdout).await?;
    if effective != granted_name.into_iter().collect::<Vec<_>>() {
        return Err("The effective Codex configuration contains unauthorized MCP servers.".into());
    }
    let input = Arc::new(AsyncMutex::new(stdin));
    let approvals: Approvals = Arc::new(Mutex::new(HashMap::new()));
    let id = Uuid::new_v4();
    let reader = tauri::async_runtime::spawn(read_output(
        window.clone(),
        id,
        stdout,
        input.clone(),
        approvals.clone(),
    ));
    *host.0.lock().map_err(|_| "Codex host is unavailable.")? = Some(Process {
        id,
        _child: child,
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
    mut lines: ServerOutput,
    input: Arc<AsyncMutex<ChildStdin>>,
    approvals: Approvals,
) {
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(packet) = serde_json::from_str::<Value>(&line) else {
            break;
        };
        if let (Some(method), Some(id)) = (packet["method"].as_str(), packet.get("id")) {
            let kind = Approval::from_method(method);
            if let Some(kind) = kind {
                if let Ok(mut pending) = approvals.lock() {
                    pending.insert(id.to_string(), (kind, packet["params"].clone()));
                }
            } else {
                let response = json!({"id": id, "error": {"code":-32601,"message":"Unsupported client request"}});
                if send(&input, response).await.is_err() {
                    break;
                }
                continue;
            }
        }
        if packet["method"] == "serverRequest/resolved" {
            if let Some(id) = packet["params"].get("requestId") {
                if let Ok(mut pending) = approvals.lock() {
                    pending.remove(&id.to_string());
                }
            }
        }
        if window
            .emit(EVENT, json!({"processId": process_id, "packet": packet}))
            .is_err()
        {
            break;
        }
    }
    let _ = window.emit(EVENT, json!({"processId": process_id, "closed": true}));
}

async fn send(input: &AsyncMutex<ChildStdin>, packet: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&packet).map_err(|err| err.to_string())?;
    bytes.push(b'\n');
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut input = input.lock().await;
        input.write_all(&bytes).await
    })
    .await
    .map_err(|_| "Writing to Codex App Server timed out.")?
    .map_err(|_| "Codex App Server has disconnected.".into())
}

fn prepare_request(packet: &mut Value, cwd: &Path, book: bool) -> Result<(), String> {
    let method = packet["method"]
        .as_str()
        .ok_or("Invalid Codex request.")?
        .to_owned();
    if !matches!(
        method.as_str(),
        "model/list" | "thread/start" | "thread/resume" | "turn/start" | "turn/interrupt"
    ) {
        return Err("Unsupported Codex request.".into());
    }
    if matches!(
        method.as_str(),
        "thread/start" | "thread/resume" | "turn/start"
    ) {
        let params = packet["params"]
            .as_object_mut()
            .ok_or("Invalid Codex parameters.")?;
        // Keep every turn in the host-owned work directory and route approvals to the user.
        params.insert("cwd".into(), json!(cwd));
        params.insert("approvalPolicy".into(), json!("on-request"));
        params.insert("approvalsReviewer".into(), json!("user"));
        if method == "turn/start" {
            params.insert(
                "sandboxPolicy".into(),
                json!({"type":"readOnly","networkAccess":false}),
            );
        } else {
            params.insert("sandbox".into(), json!("read-only"));
            params.insert(
                "developerInstructions".into(),
                json!(if book {
                    BOOK_INSTRUCTIONS
                } else {
                    GENERAL_INSTRUCTIONS
                }),
            );
        }
        params.remove("config");
        params.remove("baseInstructions");
        params.remove("modelProvider");
    }
    Ok(())
}

fn active<'a>(process: &'a Option<Process>, expected: Uuid) -> Result<&'a Process, String> {
    process
        .as_ref()
        .filter(|running| running.id == expected)
        .ok_or("The Codex process is no longer active.".into())
}

#[tauri::command]
pub async fn readany_codex_send(
    host: tauri::State<'_, CodexHost>,
    process_id: Uuid,
    mut packet: Value,
) -> Result<(), String> {
    let input = {
        let process = host.0.lock().map_err(|_| "Codex host is unavailable.")?;
        let process = active(&process, process_id)?;
        prepare_request(&mut packet, &process.cwd, process.mcp.is_some())?;
        process.input.clone()
    };
    send(&input, packet).await
}

#[tauri::command]
pub async fn readany_codex_approve(
    host: tauri::State<'_, CodexHost>,
    process_id: Uuid,
    request_id: Value,
    decision: String,
) -> Result<(), String> {
    if !matches!(decision.as_str(), "allow" | "deny" | "cancel") {
        return Err("Invalid approval decision.".into());
    }
    let (input, kind, params) = {
        let process = host.0.lock().map_err(|_| "Codex host is unavailable.")?;
        let process = active(&process, process_id)?;
        let (kind, params) = process
            .approvals
            .lock()
            .map_err(|_| "Codex approvals are unavailable.")?
            .remove(&request_id.to_string())
            .ok_or("The Codex approval is no longer pending.")?;
        (process.input.clone(), kind, params)
    };
    send(
        &input,
        json!({"id":request_id,"result":kind.response(&decision, &params)}),
    )
    .await
}

#[tauri::command]
pub async fn readany_codex_evidence(
    host: tauri::State<'_, CodexHost>,
    process_id: Uuid,
    evidence_id: String,
) -> Result<Value, String> {
    let mcp = {
        let process = host.0.lock().map_err(|_| "Codex host is unavailable.")?;
        active(&process, process_id)?
            .mcp
            .clone()
            .ok_or("This conversation has no authorized book.")?
    };
    mcp.evidence(evidence_id).await
}

#[tauri::command]
pub fn readany_codex_close(host: tauri::State<'_, CodexHost>, process_id: Uuid) {
    if let Ok(mut guard) = host.0.lock() {
        if active(&guard, process_id).is_ok() {
            guard.take();
        }
    }
}

pub(crate) fn agent_history_path(
    window: &WebviewWindow,
    filename: &str,
) -> Result<PathBuf, String> {
    let app = window.app_handle();
    if window.label() != "main" || !crate::mlx::is_development_build(app) {
        return Err("Agent history is unavailable in this window.".into());
    }
    let directory = crate::storage::default_data_root(app)?.join("readany-store");
    std::fs::create_dir_all(&directory)
        .map_err(|_| "Could not open the agent history directory.")?;
    Ok(directory.join(filename))
}

#[tauri::command]
pub fn readany_codex_history_load(window: WebviewWindow) -> Result<Vec<Value>, String> {
    let path = agent_history_path(&window, "codex-chat-history.json")?;
    match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Invalid saved Codex history.".into())
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(_) => Err("Could not read the saved Codex history.".into()),
    }
}

#[tauri::command]
pub fn readany_codex_history_save(
    window: WebviewWindow,
    history: Vec<Value>,
) -> Result<(), String> {
    let path = agent_history_path(&window, "codex-chat-history.json")?;
    crate::reading_mcp::write_private_json(&path, &history)
        .map_err(|_| "Could not save the Codex history.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forces_shell_policy_for_thread_and_turn() {
        let cwd = Path::new("/tmp/readany");
        let mut packet = json!({"method":"thread/start","params":{"cwd":"/wrong","sandbox":"danger-full-access","config":{"example":true}}});
        prepare_request(&mut packet, cwd, true).unwrap();
        assert_eq!(packet["params"]["cwd"], "/tmp/readany");
        assert_eq!(packet["params"]["sandbox"], "read-only");
        assert_eq!(packet["params"]["approvalsReviewer"], "user");
        assert!(packet["params"].get("config").is_none());
        let mut disallowed = json!({"method":"command/exec","params":{}});
        assert!(prepare_request(&mut disallowed, cwd, false).is_err());
    }

    #[test]
    fn approvals_never_persist_a_policy_change() {
        assert_eq!(
            Approval::Command.response("allow", &Value::Null),
            json!({"decision":"accept"})
        );
        assert_eq!(
            Approval::File.response("cancel", &Value::Null),
            json!({"decision":"cancel"})
        );
        let request = json!({"permissions":{"network":{"enabled":true}}});
        assert_eq!(
            Approval::Permissions.response("deny", &request),
            json!({"scope":"turn","permissions":{}})
        );
        assert_eq!(
            Approval::Permissions.response("allow", &request)["scope"],
            "turn"
        );
    }
}

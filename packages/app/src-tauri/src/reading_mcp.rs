use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use dashmap::{mapref::entry::Entry, DashMap};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use uuid::Uuid;

pub const TOOL_EVENT: &str = "readany-mcp-tool";
pub const CANCEL_EVENT: &str = "readany-mcp-cancel";
const PROTOCOLS: [&str; 3] = ["2025-11-25", "2025-06-18", "2025-03-26"];
const TOOLS: [&str; 5] = [
    "readany_get_context",
    "readany_search_book",
    "readany_read_chapter",
    "readany_get_toc",
    "readany_get_evidence",
];
const MAX_SESSIONS: usize = 16;
const MAX_REQUESTS: usize = 32;
const MAX_EVIDENCE_BYTES: u64 = 2 * 1024 * 1024;
const TOOL_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, PartialEq)]
struct Grant {
    book_id: String,
    session: Uuid,
}

fn launch_grant(args: impl Iterator<Item = String>) -> Result<Option<Grant>, String> {
    let mut book = None;
    let mut session = None;
    for arg in args {
        if let Some(value) = arg.strip_prefix("--readany-mcp-book=") {
            if book.replace(value.to_owned()).is_some() {
                return Err("Multiple ReadAny MCP book grants.".into());
            }
        } else if let Some(value) = arg.strip_prefix("--readany-mcp-session=") {
            if session
                .replace(Uuid::parse_str(value).map_err(|_| "Invalid MCP session UUID.")?)
                .is_some()
            {
                return Err("Multiple ReadAny MCP session grants.".into());
            }
        }
    }
    match (book, session) {
        (None, None) => Ok(None),
        (Some(book_id), Some(session))
            if !book_id.is_empty()
                && book_id.len() <= 128
                && book_id
                    .bytes()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_')) =>
        {
            Ok(Some(Grant { book_id, session }))
        }
        _ => Err("ReadAny MCP requires one valid book ID and one session UUID.".into()),
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    book_id: String,
    evidence: Vec<Value>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ToolRequest {
    request_id: String,
    book_id: String,
    name: String,
    arguments: Value,
    evidence: Vec<Value>,
}

#[derive(Deserialize)]
pub struct ToolReply {
    result: Option<Value>,
    error: Option<String>,
    evidence: Option<Vec<Value>>,
}

struct Session {
    protocol: String,
    ready: bool,
}

type RequestKey = (String, String);
type Cancellation = DashMap<RequestKey, Option<oneshot::Sender<()>>>;

struct Server {
    app: AppHandle,
    host: String,
    token_hash: [u8; 32],
    tools: Vec<Value>,
    sessions: Mutex<HashMap<String, Session>>,
    cancellations: Cancellation,
    replies: DashMap<String, oneshot::Sender<ToolReply>>,
    snapshot: AsyncMutex<Snapshot>,
    snapshot_path: PathBuf,
}

struct Running {
    server: Arc<Server>,
    task: tauri::async_runtime::JoinHandle<()>,
    descriptor: Option<PathBuf>,
    _lock: std::fs::File,
    _session_lock: Option<std::fs::File>,
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.server.sessions.lock() {
            sessions.clear();
        }
        for mut pending in self.server.cancellations.iter_mut() {
            if let Some(sender) = pending.value_mut().take() {
                let _ = sender.send(());
            }
        }
        self.task.abort();
        if let Some(descriptor) = &self.descriptor {
            let _ = std::fs::remove_file(descriptor);
        }
    }
}

#[derive(Default)]
pub struct ReadingMcpState(Mutex<McpListeners>);

#[derive(Default)]
struct McpListeners {
    standalone: Option<Running>,
    embedded: HashMap<Uuid, Running>,
}

pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<ReadingMcpState>() {
        if let Ok(mut running) = state.0.lock() {
            running.standalone.take();
            running.embedded.clear();
        }
    }
}

#[cfg(unix)]
pub(crate) fn write_private_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    use std::{fs::OpenOptions, io::Write, os::unix::fs::OpenOptionsExt};
    let bytes = serde_json::to_vec(value).map_err(|err| err.to_string())?;
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result.map_err(|err| err.to_string())
}

#[cfg(not(unix))]
pub(crate) fn write_private_json(_: &Path, _: &impl Serialize) -> Result<(), String> {
    Err("Private MCP storage is unavailable on this platform.".into())
}

#[cfg(unix)]
fn private_root(app: &AppHandle) -> Result<PathBuf, String> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let root = crate::storage::default_data_root(app)?.join("desktop-mcp");
    match std::fs::DirBuilder::new().mode(0o700).create(&root) {
        Ok(()) => (),
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(err) => return Err(err.to_string()),
    }
    let metadata = std::fs::symlink_metadata(&root).map_err(|err| err.to_string())?;
    if !metadata.is_dir() || metadata.permissions().mode() & 0o077 != 0 {
        return Err("The ReadAny MCP directory must be a private directory (0700).".into());
    }
    Ok(root)
}

fn restore_snapshot(path: &Path, book_id: String) -> Result<Snapshot, String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_EVIDENCE_BYTES => {
            let snapshot: Snapshot =
                serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                    .map_err(|_| "Invalid saved MCP evidence.")?;
            if snapshot.book_id != book_id || !valid_evidence(&snapshot.evidence, &book_id) {
                return Err("The saved MCP session belongs to another book or is invalid.".into());
            }
            Ok(snapshot)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Snapshot {
            book_id,
            evidence: vec![],
        }),
        _ => Err("Invalid saved MCP evidence file.".into()),
    }
}

fn valid_evidence(evidence: &[Value], book_id: &str) -> bool {
    evidence.len() <= 512
        && evidence.iter().all(|item| {
            item["bookId"].as_str() == Some(book_id)
                && item["type"] == "book"
                && item["chapterIndex"].as_u64().is_some()
                && item["chapterTitle"].is_string()
                && item["cfi"]
                    .as_str()
                    .is_some_and(|cfi| cfi.starts_with("epubcfi(") && cfi.ends_with(')'))
                && item["text"]
                    .as_str()
                    .is_some_and(|text| !text.is_empty() && text.chars().count() <= 220)
                && item["retrievalMethod"].is_string()
        })
}

#[tauri::command]
pub async fn readany_mcp_start(
    window: WebviewWindow,
    tools: Vec<Value>,
    state: tauri::State<'_, ReadingMcpState>,
) -> Result<bool, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, tools, state);
        Ok(false)
    }
    #[cfg(target_os = "macos")]
    {
        let app = window.app_handle();
        if window.label() != "main" || !crate::mlx::is_development_build(app) {
            return Ok(false);
        }
        let Some(grant) = launch_grant(std::env::args().skip(1))? else {
            return Ok(false);
        };
        let mut running = state.0.lock().map_err(|_| "MCP state unavailable.")?;
        if running.standalone.is_some() {
            return Ok(true);
        }
        if !running.embedded.is_empty() {
            return Err("An embedded ReadAny MCP session is active.".into());
        }
        let (server, _, _) = start_server(app, tools, grant, true)?;
        running.standalone = Some(server);
        Ok(true)
    }
}

#[cfg(target_os = "macos")]
fn start_server(
    app: &AppHandle,
    tools: Vec<Value>,
    grant: Grant,
    standalone: bool,
) -> Result<(Running, String, String), String> {
    use std::os::unix::fs::OpenOptionsExt;
    if tools.len() != TOOLS.len()
        || !TOOLS
            .iter()
            .all(|name| tools.iter().any(|tool| tool["name"] == *name))
    {
        return Err("Unexpected ReadAny MCP tool list.".into());
    }
    let root = private_root(app)?;
    let lock_file = |name: &str| {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(root.join(name))
            .map_err(|err| err.to_string())
    };
    let lock = lock_file("server.lock")?;
    if standalone {
        lock.try_lock()
    } else {
        lock.try_lock_shared()
    }
    .map_err(|_| "Another ReadAny process already provides MCP.")?;
    let session_lock = if standalone {
        None
    } else {
        let lock = lock_file(&format!("embedded-{}.lock", grant.session))?;
        lock.try_lock()
            .map_err(|_| "This ReadAny MCP scope is already in use.")?;
        Some(lock)
    };
    let snapshot_path = root.join(format!("evidence-{}.json", grant.session));
    let snapshot = restore_snapshot(&snapshot_path, grant.book_id)?;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|err| err.to_string())?;
    let host = listener
        .local_addr()
        .map_err(|err| err.to_string())?
        .to_string();
    listener
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let listener = tokio::net::TcpListener::from_std(listener).map_err(|err| err.to_string())?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let url = format!("http://{host}/mcp");
    let descriptor = if standalone {
        let file = root.join("connection.json");
        write_private_json(
            &file,
            &json!({
                "url": url, "token": token, "bookId": snapshot.book_id, "session": grant.session
            }),
        )?;
        Some(file)
    } else {
        None
    };
    let server = Arc::new(Server {
        app: app.clone(),
        host,
        token_hash: Sha256::digest(token.as_bytes()).into(),
        tools,
        sessions: Mutex::default(),
        cancellations: DashMap::new(),
        replies: DashMap::new(),
        snapshot: AsyncMutex::new(snapshot),
        snapshot_path,
    });
    let router = Router::new()
        .route(
            "/mcp",
            post(handle_post).get(handle_get).delete(handle_delete),
        )
        .layer(DefaultBodyLimit::max(32 * 1024))
        .with_state(server.clone());
    let task = tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("ReadAny MCP listener: {error}");
        }
    });
    Ok((
        Running {
            server,
            task,
            descriptor,
            _lock: lock,
            _session_lock: session_lock,
        },
        url,
        token,
    ))
}

#[cfg(target_os = "macos")]
pub(crate) struct EmbeddedMcp {
    pub(crate) url: String,
    pub(crate) token: String,
    server: Arc<Server>,
    session: Uuid,
}

#[cfg(target_os = "macos")]
impl EmbeddedMcp {
    pub(crate) fn start(
        app: &AppHandle,
        tools: Vec<Value>,
        book: String,
        session: Uuid,
    ) -> Result<Self, String> {
        let grant = launch_grant(
            [
                format!("--readany-mcp-book={book}"),
                format!("--readany-mcp-session={session}"),
            ]
            .into_iter(),
        )?
        .ok_or("Missing ReadAny book grant.")?;
        let state = app.state::<ReadingMcpState>();
        let mut running = state.0.lock().map_err(|_| "MCP state unavailable.")?;
        if running.standalone.is_some() || running.embedded.contains_key(&session) {
            return Err("This ReadAny MCP scope is already in use.".into());
        }
        let (next, url, token) = start_server(app, tools, grant, false)?;
        let server = next.server.clone();
        running.embedded.insert(session, next);
        Ok(Self {
            url,
            token,
            server,
            session,
        })
    }

    pub(crate) async fn evidence(&self, evidence_id: String) -> Result<Value, String> {
        tokio::time::timeout(
            Duration::from_secs(10),
            invoke_reading_tool(
                &self.server,
                "readany_get_evidence",
                json!({ "evidenceId": evidence_id }),
            ),
        )
        .await
        .map_err(|_| "Book evidence lookup timed out.".to_string())?
    }
}

#[cfg(target_os = "macos")]
impl Drop for EmbeddedMcp {
    fn drop(&mut self) {
        let state = self.server.app.state::<ReadingMcpState>();
        if let Ok(mut running) = state.0.lock() {
            if running
                .embedded
                .get(&self.session)
                .is_some_and(|active| Arc::ptr_eq(&active.server, &self.server))
            {
                running.embedded.remove(&self.session);
            }
        };
    }
}

#[tauri::command]
pub fn readany_mcp_reply(
    window: WebviewWindow,
    request_id: String,
    reply: ToolReply,
    state: tauri::State<'_, ReadingMcpState>,
) {
    if window.label() != "main" {
        return;
    }
    if let Ok(running) = state.0.lock() {
        let sender = running
            .standalone
            .iter()
            .chain(running.embedded.values())
            .find_map(|listener| listener.server.replies.remove(&request_id));
        if let Some((_, sender)) = sender {
            let _ = sender.send(reply);
        }
    }
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn authenticate(
    headers: &HeaderMap,
    host: &str,
    expected_token: &[u8; 32],
) -> Result<(), StatusCode> {
    if header(headers, "host") != Some(host) || headers.contains_key("origin") {
        return Err(StatusCode::FORBIDDEN);
    }
    let token = header(headers, "authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let actual: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    if actual
        .iter()
        .zip(expected_token)
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        != 0
    {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}

fn rpc_error(id: Value, code: i32, message: &str) -> Response {
    Json(json!({"jsonrpc":"2.0", "id": id, "error":{"code":code, "message":message}}))
        .into_response()
}

fn rpc_result(id: Value, result: Value) -> Response {
    Json(json!({"jsonrpc":"2.0", "id": id, "result":result})).into_response()
}

fn tool_error(id: Value, message: &str) -> Response {
    rpc_result(
        id,
        json!({"content":[{"type":"text","text":message}], "isError":true}),
    )
}

fn initialize(server: &Server, id: Value, params: &Value) -> Response {
    let Some(requested) = params["protocolVersion"].as_str() else {
        return rpc_error(id, -32602, "Expected protocolVersion.");
    };
    let version = PROTOCOLS
        .iter()
        .copied()
        .find(|v| *v == requested)
        .unwrap_or(PROTOCOLS[0]);
    let token = Uuid::new_v4().to_string();
    let mut sessions = server.sessions.lock().expect("MCP session lock");
    if sessions.len() >= MAX_SESSIONS {
        return rpc_error(id, -32000, "Too many MCP sessions.");
    }
    sessions.insert(
        token.clone(),
        Session {
            protocol: version.into(),
            ready: false,
        },
    );
    let mut response = rpc_result(
        id,
        json!({
            "protocolVersion": version,
            "capabilities": {"tools": {}},
            "serverInfo": {"name":"readany-desktop", "version":env!("CARGO_PKG_VERSION")}
        }),
    );
    response.headers_mut().insert(
        "mcp-session-id",
        HeaderValue::from_str(&token).expect("UUID header"),
    );
    response
}

fn session(
    headers: &HeaderMap,
    server: &Server,
    mark_ready: bool,
) -> Result<(String, bool), StatusCode> {
    let id = header(headers, "mcp-session-id").ok_or(StatusCode::BAD_REQUEST)?;
    let mut sessions = server
        .sessions
        .lock()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let session = sessions.get_mut(id).ok_or(StatusCode::NOT_FOUND)?;
    if headers.contains_key("mcp-protocol-version")
        && header(headers, "mcp-protocol-version") != Some(&session.protocol)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    session.ready |= mark_ready;
    Ok((id.to_owned(), session.ready))
}

fn valid_id(value: &Value) -> bool {
    value.as_str().is_some_and(|id| id.len() <= 128) || value.is_i64() || value.is_u64()
}

async fn handle_post(
    State(server): State<Arc<Server>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(status) = authenticate(&headers, &server.host, &server.token_hash) {
        return status.into_response();
    }
    let packet: Value = match serde_json::from_slice(&body) {
        Ok(packet) => packet,
        Err(_) => return rpc_error(Value::Null, -32700, "Invalid JSON."),
    };
    let id = packet.get("id").cloned();
    let Some(method) = packet.get("method").and_then(Value::as_str) else {
        return rpc_error(Value::Null, -32600, "Invalid request.");
    };
    if packet["jsonrpc"] != "2.0" || id.as_ref().is_some_and(|id| !valid_id(id)) {
        return rpc_error(Value::Null, -32600, "Invalid request.");
    }
    let params = &packet["params"];
    if method == "initialize" {
        return id.map_or_else(
            || rpc_error(Value::Null, -32600, "Expected a request ID."),
            |id| initialize(&server, id, params),
        );
    }

    let mark_ready = method == "notifications/initialized" && id.is_none();
    let (session_id, ready) = match session(&headers, &server, mark_ready) {
        Ok(session) => session,
        Err(status) => return status.into_response(),
    };
    let Some(id) = id else {
        if method == "notifications/cancelled" && valid_id(&params["requestId"]) {
            if let Some(mut entry) = server
                .cancellations
                .get_mut(&(session_id, params["requestId"].to_string()))
            {
                if let Some(sender) = entry.value_mut().take() {
                    let _ = sender.send(());
                }
            }
        }
        return StatusCode::ACCEPTED.into_response();
    };
    if !ready && method != "ping" {
        return rpc_error(id, -32000, "MCP session is not initialized.");
    }
    match method {
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, json!({"tools": &server.tools})),
        "tools/call" => {
            let Some(name) = params["name"].as_str().filter(|name| TOOLS.contains(name)) else {
                return rpc_error(id, -32602, "Unknown reading tool.");
            };
            let key = (session_id, id.to_string());
            if server.cancellations.len() >= MAX_REQUESTS {
                return tool_error(id, "Too many pending requests.");
            }
            let (sender, receiver) = oneshot::channel();
            {
                // Admit a call while holding the same lock used to delete its session.
                let sessions = server.sessions.lock().expect("MCP session lock");
                if !sessions.contains_key(&key.0) {
                    return StatusCode::NOT_FOUND.into_response();
                }
                match server.cancellations.entry(key.clone()) {
                    Entry::Occupied(_) => {
                        return rpc_error(id, -32600, "Request ID is already in use.")
                    }
                    Entry::Vacant(entry) => {
                        entry.insert(Some(sender));
                    }
                }
            }
            let _request = RequestGuard {
                server: &server,
                key,
            };
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let result = tokio::select! {
                biased;
                _ = receiver => Err("ReadAny tool request was cancelled.".into()),
                result = tokio::time::timeout(TOOL_TIMEOUT, invoke_reading_tool(&server, name, arguments)) =>
                    result.unwrap_or_else(|_| Err("ReadAny tool request timed out.".into())),
            };
            match result {
                Ok(value) => rpc_result(
                    id,
                    json!({
                        "content":[{"type":"text","text":value.to_string()}],
                        "structuredContent":value,
                        "isError":false
                    }),
                ),
                Err(message) => tool_error(id, &message),
            }
        }
        _ => rpc_error(id, -32601, "Method not found."),
    }
}

async fn handle_get(State(server): State<Arc<Server>>, headers: HeaderMap) -> Response {
    match authenticate(&headers, &server.host, &server.token_hash) {
        Ok(()) => StatusCode::METHOD_NOT_ALLOWED.into_response(),
        Err(status) => status.into_response(),
    }
}

async fn handle_delete(State(server): State<Arc<Server>>, headers: HeaderMap) -> Response {
    if let Err(status) = authenticate(&headers, &server.host, &server.token_hash) {
        return status.into_response();
    }
    let (id, _) = match session(&headers, &server, false) {
        Ok(session) => session,
        Err(status) => return status.into_response(),
    };
    server
        .sessions
        .lock()
        .expect("MCP session lock")
        .remove(&id);
    for mut entry in server.cancellations.iter_mut() {
        if entry.key().0 == id {
            if let Some(sender) = entry.value_mut().take() {
                let _ = sender.send(());
            }
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

struct RequestGuard<'a> {
    server: &'a Server,
    key: RequestKey,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        self.server.cancellations.remove(&self.key);
    }
}

struct ReplyGuard<'a> {
    server: &'a Server,
    id: String,
    window: WebviewWindow,
    delivered: bool,
}

impl Drop for ReplyGuard<'_> {
    fn drop(&mut self) {
        self.server.replies.remove(&self.id);
        if !self.delivered {
            let _ = self.window.emit(CANCEL_EVENT, &self.id);
        }
    }
}

async fn invoke_reading_tool(
    server: &Server,
    name: &str,
    arguments: Value,
) -> Result<Value, String> {
    let mut snapshot = server.snapshot.lock().await;
    let window = server
        .app
        .get_webview_window("main")
        .ok_or("ReadAny is closing.")?;
    let (sender, receiver) = oneshot::channel();
    let id = Uuid::new_v4().to_string();
    server.replies.insert(id.clone(), sender);
    let mut pending = ReplyGuard {
        server,
        id: id.clone(),
        window,
        delivered: false,
    };
    pending
        .window
        .emit(
            TOOL_EVENT,
            ToolRequest {
                request_id: id,
                book_id: snapshot.book_id.clone(),
                name: name.into(),
                arguments,
                evidence: snapshot.evidence.clone(),
            },
        )
        .map_err(|_| "Could not reach the ReadAny reader.")?;
    let reply = receiver
        .await
        .map_err(|_| "The ReadAny reader did not reply.")?;
    pending.delivered = true;
    if let Some(error) = reply.error {
        return Err(error.chars().take(400).collect());
    }
    let result = reply
        .result
        .filter(Value::is_object)
        .ok_or("Invalid reading tool response.")?;
    let evidence = reply.evidence.ok_or("Missing reading tool evidence.")?;
    if snapshot.evidence != evidence {
        if !evidence.starts_with(&snapshot.evidence)
            || !valid_evidence(&evidence, &snapshot.book_id)
        {
            return Err("Invalid reading tool evidence.".into());
        }
        let next = Snapshot {
            book_id: snapshot.book_id.clone(),
            evidence,
        };
        write_private_json(&server.snapshot_path, &next)
            .map_err(|_| "Could not save reading evidence.")?;
        *snapshot = next;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_explicit_book_and_uuid_and_rejects_path_segments() {
        assert_eq!(launch_grant(std::iter::empty()).unwrap(), None);
        let args = |book: &str| {
            [
                format!("--readany-mcp-book={book}"),
                format!("--readany-mcp-session={}", Uuid::nil()),
            ]
            .into_iter()
        };
        assert_eq!(
            launch_grant(args("book-1")).unwrap().unwrap().book_id,
            "book-1"
        );
        assert!(launch_grant(args("../other")).is_err());
        assert!(launch_grant(["--readany-mcp-book=book-1".into()].into_iter()).is_err());
    }

    #[test]
    fn denies_missing_or_incorrect_auth_and_nonlocal_origin() {
        let hash = Sha256::digest(b"test-token").into();
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("bad.example"));
        assert_eq!(
            authenticate(&headers, "127.0.0.1:80", &hash),
            Err(StatusCode::FORBIDDEN)
        );
        headers.insert("host", HeaderValue::from_static("127.0.0.1:80"));
        assert_eq!(
            authenticate(&headers, "127.0.0.1:80", &hash),
            Err(StatusCode::UNAUTHORIZED)
        );
        headers.insert("authorization", HeaderValue::from_static("Bearer invalid"));
        assert_eq!(
            authenticate(&headers, "127.0.0.1:80", &hash),
            Err(StatusCode::UNAUTHORIZED)
        );
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer test-token"),
        );
        assert_eq!(authenticate(&headers, "127.0.0.1:80", &hash), Ok(()));
        headers.insert("origin", HeaderValue::from_static("http://127.0.0.1:80"));
        assert_eq!(
            authenticate(&headers, "127.0.0.1:80", &hash),
            Err(StatusCode::FORBIDDEN)
        );
    }
}

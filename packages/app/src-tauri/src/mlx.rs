use crate::storage;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tauri::{path::BaseDirectory, AppHandle, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
    time::timeout,
};

pub const DEV_IDENTIFIER: &str = "com.readany.mlx.macos.dev";

pub fn is_development_build(app: &AppHandle) -> bool {
    app.config().identifier == DEV_IDENTIFIER
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum Request {
    Status,
    ImportModel { source: PathBuf },
    Load,
    Unload,
    Embed { texts: Vec<String> },
}

#[derive(Deserialize, Serialize)]
struct ModelStatus {
    available: bool,
    imported: bool,
    loaded: bool,
}

#[derive(Deserialize, Serialize)]
pub struct Response {
    status: Option<ModelStatus>,
    vectors: Option<Vec<Vec<f32>>>,
    error: Option<String>,
}

struct Sidecar {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Sidecar {
    fn start(app: &AppHandle) -> Result<Self, String> {
        let resource = app
            .path()
            .resolve("mlx/Qwen3Sidecar", BaseDirectory::Resource)
            .map_err(|err| err.to_string())?;
        #[cfg(debug_assertions)]
        let resource = if resource.is_file() {
            resource
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/mlx-sidecar/Qwen3Sidecar")
        };
        let model_path =
            storage::default_data_root(app)?.join("ReadAnyModels/Qwen3Embedding4BMLXQ8");
        let mut child = Command::new(resource)
            .arg(model_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|err| format!("Could not start Qwen3 MLX: {err}"))?;
        let input = child.stdin.take().ok_or("Missing Qwen3 stdin")?;
        let output = BufReader::new(child.stdout.take().ok_or("Missing Qwen3 stdout")?);
        Ok(Self {
            child,
            input,
            output,
        })
    }

    async fn request(&mut self, request: &Request) -> Result<Response, String> {
        let mut data = serde_json::to_vec(request).map_err(|err| err.to_string())?;
        data.push(b'\n');
        self.input
            .write_all(&data)
            .await
            .map_err(|err| err.to_string())?;
        let mut line = String::new();
        let count = self
            .output
            .read_line(&mut line)
            .await
            .map_err(|err| err.to_string())?;
        if count == 0 {
            return Err("Qwen3 MLX exited before responding".into());
        }
        serde_json::from_str(&line).map_err(|err| format!("Invalid Qwen3 response: {err}"))
    }
}

#[derive(Default)]
pub struct MlxState(Mutex<Option<Sidecar>>);

#[tauri::command]
pub async fn mlx_embedding(
    app: AppHandle,
    state: State<'_, MlxState>,
    request: Request,
) -> Result<Response, String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) || !is_development_build(&app) {
        return Err("This build does not support Qwen3 MLX.".into());
    }
    let mut process = state.0.lock().await;
    // Own the child for this request. If the task is cancelled or the pipe
    // becomes desynchronized, kill it instead of consuming a stale reply.
    let mut sidecar = if let Some(mut running) = process.take() {
        if running
            .child
            .try_wait()
            .map_err(|err| err.to_string())?
            .is_none()
        {
            running
        } else {
            Sidecar::start(&app)?
        }
    } else {
        Sidecar::start(&app)?
    };
    let result = timeout(Duration::from_secs(300), sidecar.request(&request))
        .await
        .map_err(|_| "Qwen3 MLX request timed out".to_string())??;
    *process = Some(sidecar);
    if let Some(error) = result.error {
        return Err(error);
    }
    Ok(result)
}

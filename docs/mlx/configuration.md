# 模型与服务配置

[文档索引](README.md) · [English](#english)

## 向量模型

1. 下载 [Qwen3-Embedding-4B MLX Q8 固定快照](https://huggingface.co/majentik/Qwen3-Embedding-4B-MLX-8bit/tree/bf6643fd2d34f6832a1203c870564b1633183885)。将 `config.json`、`tokenizer.json`、`tokenizer_config.json` 和 `model.safetensors` 放在同一个文件夹。权重约 4.27 GB，导入时还需为应用管理的副本预留空间。
2. iPad 从「我的 → 向量模型」导入文件夹。Mac 从「设置 → 向量模型 → 内置本地模型」导入。应用按 SHA-256 校验文件。选择「加载并使用」。
3. 导入 EPUB，从书籍菜单建立向量索引，再测试语义或混合检索。切换 Embedding 模型后，需为要查询的书建立与新模型匹配的索引。卸载模型只释放推理内存。

## 原生聊天与 Parallel

在 AI 设置中配置聊天模型及其服务端点。Qwen3 Q8 负责向量化，聊天模型负责生成回答。选择托管聊天服务时，用户问题及本轮选取的读书上下文可能发给该服务。离线使用可以直接做已索引书籍的检索，离线生成回答另需可用的本地聊天配置。

联网研究在「AI 设置 → 联网研究」下提供关闭、自动和强制，默认关闭。关闭适用于只查询书内证据。自动由聊天流程按问题、上下文和防剧透设置选择工具。Parallel 接收网页搜索查询词或读取目标，可能受服务限流。已有书内索引仍可独立查询。[统一研究设计](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/docs/superpowers/specs/2026-11-21-unified-research-design.md)。

## 桌面 Agent

以下入口位于 `feat/macos-mlx-agents`。在主页「对话」或 EPUB 阅读器「AI 提问」切换运行时，再选当前书籍、章节、选区或全局范围。受授权的书籍证据可能提交给 Agent 模型。全局会话无 ReadAny 单书 MCP。

| 入口 | 准备与使用 |
| :--- | :--- |
| **Codex** | 安装兼容 Codex CLI，执行 `codex login status` 确认已有登录态。自定义路径使用 `READANY_CODEX_BIN`。[Codex 指南](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/codex-chat.md) |
| **Antigravity** | 安装兼容 `agy` 并用 CLI 的官方流程登录。自定义路径使用 `READANY_AGY_BIN`。模型、思考强度和权限档位取决于当前 CLI 与账号能力。完全访问会关闭 CLI 的终端沙箱，单书 MCP 授权另行管理。[ACP 指南](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/antigravity-acp.md) |
| **独立 ReadAny MCP** | 按指南显式指定书籍 ID 与阅读会话，连接描述符中的令牌留在本机。[独立连接指南](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/desktop-agents.md) |

Codex 和 Antigravity 各自使用运行时提供的网页工具。ReadAny 原生聊天继续使用 Parallel。阅读器和主页可恢复同一会话，重启续聊同时依赖本地 ReadAny 历史和 CLI 的对应会话。

## English

[Documentation index](README.md#english)

### Embedding model

1. Download the [pinned Qwen3-Embedding-4B MLX Q8 snapshot](https://huggingface.co/majentik/Qwen3-Embedding-4B-MLX-8bit/tree/bf6643fd2d34f6832a1203c870564b1633183885). Place `config.json`, `tokenizer.json`, `tokenizer_config.json`, and `model.safetensors` in one folder. The weights are about 4.27 GB. Allow for an app-managed copy on import.
2. On iPad, open Embedding Models from the profile area. On Mac, open Settings, Embedding Models, then Built-in Local Models. Import the folder, let the app verify the file hashes, and select Load and Use. The iPad MLX card uses the labels `导入模型文件夹` (Import Model Folder) and `加载并使用` (Load and Use).
3. Import an EPUB, build its index from the book menu, and try semantic or hybrid search. When switching embedding models, build an index that matches the selected model for each book you want to query. Unloading frees inference memory.

### Built-in chat and Parallel

Configure a chat model and its endpoint in AI settings. Qwen3 Q8 produces embeddings, while the configured chat model generates answers. A hosted chat provider may receive the prompt and selected reading context. You can search an indexed book offline. Offline answer generation requires a working local chat configuration.

AI Settings offers Off, Auto, and Always for web research, with Off as the default. Auto can select tools based on the question, context, and spoiler settings. Parallel receives web queries or fetch targets and may rate-limit them. Local book retrieval can continue independently. [Unified research design](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/docs/superpowers/specs/2026-11-21-unified-research-design.md).

### Desktop agents

On `feat/macos-mlx-agents`, choose the runtime in the home chat or the EPUB reader sidebar. Select a book, chapter, selection, or global scope. Authorized book evidence may be sent to the agent model. Global sessions have no ReadAny book MCP authorization.

| Runtime | Setup |
| :--- | :--- |
| **Codex** | Install a compatible CLI and run `codex login status` to confirm sign-in. Use `READANY_CODEX_BIN` for a custom path. [Codex guide](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/codex-chat.md) |
| **Antigravity** | Install a compatible `agy` and sign in through the CLI. Use `READANY_AGY_BIN` for a custom path. Models, effort, and permission modes depend on CLI and account support. Full Access disables the CLI terminal sandbox. Single-book MCP authorization is managed separately. [ACP guide](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/antigravity-acp.md) |
| **Standalone ReadAny MCP** | Explicitly authorize a book ID and reading session. Keep the connection descriptor's token local. [Connection guide](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/desktop-agents.md) |

Codex and Antigravity use their own web tools. Built-in ReadAny chat continues to use Parallel. The reader and home view can resume the same session. Recovery after restart also depends on both local ReadAny history and the corresponding CLI session.

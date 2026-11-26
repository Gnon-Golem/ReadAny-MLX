# 系统架构

[中文首页](../../README.md) · [文档索引](README.md) · [English](#english)

## 设备内向量推理

ReadAny Core 负责拆分 EPUB、组织索引和检索。iPad 通过 Expo 原生模块调用 Swift，macOS 通过 Tauri 管理独立的 Swift 推理进程。两条路径均通过 MLX Swift 和 Metal 加载本机的 Qwen3-Embedding-4B Q8 权重。模型对单条输入做末位 token 池化和 L2 归一化，返回 2,560 维向量。输入最多 1,024 个 token，包含末尾终止符。查询应用检索指令，书籍正文分块按文档输入编码。[iPad Swift 验证工具](https://github.com/Gnon-Golem/ReadAny-MLX/tree/mlx-ios/tools/qwen3-mlx-validation) · [macOS 实现说明](https://github.com/Gnon-Golem/ReadAny-MLX/blob/macos-mlx/docs/macos-mlx.md)

索引把分块与模型身份、向量及 EPUB CFI 定位关联起来。关键词通道用 BM25，语义通道按向量相似度取回候选，混合检索通过倒数排名融合（RRF）合并两路排序。既有 ONNX 与远程向量模型仍使用各自对应的索引。导入权重之后，书籍索引与匹配模型的检索可离线运行。[共享研究系统设计](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/docs/superpowers/specs/2026-11-21-unified-research-design.md)

## 研究证据与网络

- **原生 AI 阅读助手**使用配置的聊天模型。开启 Parallel 后，共享研究流程可在同一轮取回书籍证据、搜索网页并读取选定网页。书籍摘录和网页结果经证据登记后用于引用。应用可根据 EPUB CFI 回到书内位置，或打开网页原始 URL。
- **外部 Agent**在完整 macOS 版上由本机 CLI 驱动。Codex 使用 App Server，Antigravity 使用 ACP。授权单书时，CLI 通过 ReadAny MCP 取得书内证据和定位。Agent 可以通过自己的联网工具研究网页，回答中的书籍引用关联到本会话登记的证据。
- **对外传输**取决于所启用的服务。原生聊天可将送入提示词的书籍上下文发送给远程聊天模型，Parallel 接收搜索词和读取目标，外部 Agent 可将已获授权的摘录交给自身使用的模型服务。[配置和网络边界](configuration.md)

## ReadAny MCP 与会话

MCP 通过回环地址监听，使用临时访问令牌，书籍和阅读会话均参与授权。五项只读工具为 `readany_get_context`、`readany_search_book`、`readany_read_chapter`、`readany_get_toc` 和 `readany_get_evidence`。全局 Agent 聊天不挂载单书 MCP。CLI 权限档位独立于 MCP 授权。[MCP 连接与授权指南](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/desktop-agents.md)

阅读器和主页可以打开同一已保存的阅读会话，书籍引用保留原 EPUB 定位。应用持久化运行时所需的会话标识，重启后继续对应的 Codex thread 或 Antigravity 会话。两个运行时各自保存历史。[Codex App Server](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/codex-chat.md) · [Antigravity ACP](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/antigravity-acp.md)

## English

[English home](../../README.en.md) · [Documentation index](README.md#english) · [简体中文](#系统架构)

### On-device embeddings

ReadAny Core splits EPUB text, manages indexes, and retrieves passages. On iPad, an Expo native module calls Swift. On macOS, Tauri manages a dedicated Swift inference process. Both load the local Qwen3-Embedding-4B Q8 weights through MLX Swift and Metal. The model uses last-token pooling and L2 normalization to produce 2,560-dimensional vectors. Inputs are capped at 1,024 tokens, including the end token. Queries use a retrieval instruction and book passages are encoded as documents. [iPad Swift validation tools](https://github.com/Gnon-Golem/ReadAny-MLX/tree/mlx-ios/tools/qwen3-mlx-validation) · [macOS implementation](https://github.com/Gnon-Golem/ReadAny-MLX/blob/macos-mlx/docs/macos-mlx.md)

The index associates each passage with its embedding model, vector, and EPUB CFI locator. Keyword retrieval uses BM25, semantic retrieval ranks by vector similarity, and hybrid retrieval combines the two rankings using reciprocal rank fusion (RRF). Existing ONNX and remote embedding models retain their own indexes. After importing the weights, indexing and retrieval with the matching local model can run offline. [Shared research design](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/docs/superpowers/specs/2026-11-21-unified-research-design.md)

### Research evidence and network access

- **The built-in reading assistant** uses the configured chat model. With Parallel enabled, a research turn can retrieve passages, search the web, and read selected pages. The evidence registry tracks excerpts and web results for citations. The app can use the EPUB CFI to reopen the cited passage or open the source URL.
- **External agents** run through local CLIs in the full macOS edition. Codex uses App Server and Antigravity uses ACP. With a book authorized, agents retrieve evidence and locators through ReadAny MCP. They can use their own web tools and cite book evidence registered in the current session.
- **Data sent over the network** depends on the enabled services. Built-in chat can send book context in prompts to a remote chat model. Parallel receives search queries and fetch targets. External agents may send authorized passages to their own model services. [Configuration and network boundaries](configuration.md#english)

### ReadAny MCP and session recovery

The MCP server listens on loopback and uses a temporary access token. Authorization is scoped to the book and reading session. Its five read-only tools are `readany_get_context`, `readany_search_book`, `readany_read_chapter`, `readany_get_toc`, and `readany_get_evidence`. Global chat opens without the single-book MCP. CLI permission modes are managed independently. [MCP connection and authorization](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/desktop-agents.md)

The reader and home screen can reopen the same saved reading session, with book citations retaining their original EPUB locations. The app persists the runtime's session identifier to resume the Codex thread or Antigravity session after restart. The two runtimes keep separate histories. [Codex App Server](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/codex-chat.md) · [Antigravity ACP](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/antigravity-acp.md)

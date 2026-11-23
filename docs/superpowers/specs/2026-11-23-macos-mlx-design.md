# ReadAny MLX macOS 移植差异报告

以 `feat/unified-research` 的 1.3.7（`05ac30d2`）为基线，在 `feat/macos-mlx` 为 Apple Silicon 提供独立桌面研究版。验收优先使用本机已有的 Qwen3 Q8 快照及原创 EPUB。Codex App Server、Antigravity ACP 和 iPad 远程 Agent 留给后续阶段。

| 范围 | 基线能力 | Mac 移植工作 |
| --- | --- | --- |
| `packages/core/src/rag/` | 共享切块、每书向量来源、BM25、余弦和 RRF。原始向量已经保存在本地 chunks | 用现有 embedding engine 接口接入 MLX。维持表结构和来源约束 |
| `packages/core/src/ai/` | 共享章节、本地检索、引用登记、研究路由、Parallel Provider，研究工具 24 次总额度 | 沿用桌面的研究设置与聊天入口，并验证真实运行 |
| `packages/app/src/` | Tauri 文件访问、EPUB 提取和 CFI 阅读器，已有向量设置、手动索引和检索模式 | 在现有向量设置增加模型文件夹导入、状态、加载和卸载，沿用现有检索及引用 UI |
| `packages/app/src-tauri/` | sqlite-vec 启动默认 384d，已读取旧表真实维度。重新初始化目前缺少空表的后端检查，向 Core 返回的是 L2 距离 | 禁止修改非空 vec0 维度并让空表重配具有事务性。对指定书籍以现有 sqlite-vec 计算余弦相似度，与 Core 的阈值语义一致 |
| `packages/app-expo/modules/readany-mlx-embedding/` | Swift Package 已支持 macOS 14 及 iOS 17。共用 Qwen3 推理、Tokenizer、1024 token 截断和归一化。iPad 后端含 UIKit 生命周期及快照校验 | 提取快照文件校验和原子导入到同一个 Swift Package，iPad 使用原目录。Mac 用 Tauri 管理的 Swift Sidecar |
| `tools/qwen3-mlx-validation/` | MacProbe Xcode 构建生成 Metal 资源，并提供 Python/Swift parity 检查 | 将 sidecar 对同一 fixture 和既有参考向量做对照；复用 Xcode 的 Metal 构建路径 |

## 实现选择

持久 Swift Sidecar 经 stdin/stdout JSON Lines 与 Rust 通信。进程常驻以复用加载后的模型，应用退出或 IPC 失效时关闭，使用本地专用 IPC，不监听网络。Rust 只暴露状态、导入、加载、卸载、向量命令。Swift Package 直接链接现有推理实现并随包携带 Metal 资源。在进程内做 Swift FFI 会引入跨语言对象和异常生命周期处理。另设本地 HTTP 服务会增加监听地址、认证和端口管理。

模型导入用本机现有目录作为文件来源，复制到开发版专有 Application Support 并校验四个固定 SHA-256，模型 ID、维度 2560 与 1024 token 上限沿用。支持同卷写时复制时可减少物理存储，原始目录继续用于参考验证。模型进程顺序处理生命周期和每批向量请求，单条推理沿用已验证的无填充路径。

开发包采用 `com.readany.mlx.macos.dev`、独立应用名称和开发 WebView 来源。存储固定在该标识的应用数据目录。禁用开发版对官方 Release 的自动和手动更新接入。Mac 之外的默认构建维持既有标识。禁止以改变模型为由自动重建或清除其他书籍索引。非空 vec0 表维度与当前书不一致时，继续通过 Core 从已保存的 chunks 检索。

## 阶段与验证

1. 单独提交审计报告。
2. 提交 Swift IPC、Metal 构建与 Tauri 原生命令，验证快照身份、向量范数及与 MacProbe 一致。
3. 提交 SQLite 兼容与应用隔离，验证空库重配、非空拒绝、指定书籍的向量排序、首次及再次启动。
4. 提交桌面设置和 Core 接线，检查 Qwen3、ONNX 和远程 Embedding 的分流与既有研究设置。
5. 使用原创 EPUB 执行离线向量化、真实片段和 CFI 检查；检验重启持久化。使用可用的凭据执行 Parallel 和普通 API 测试，逐项记录凭据、网络和 UI 证据边界。

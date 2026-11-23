# 桌面阅读工具与 MCP 第一阶段

稳定基线为 `feat/macos-mlx` 的 `5bf24f6a`。Tauri 同步启动书库和 sqlite-vec，从旧 vec0 表读取真实维度。WebView 在 `main.tsx` 注册 Tauri 平台、原文件提取、内置/远程查询服务和 TauriVectorDB。Qwen3 查询指令沿用 Core 内置模型服务，经桌面 embedding adapter、Tauri IPC 和 Swift Sidecar 推理。Core 保留每书来源校验、关键词和余弦检索、RRF、原文件回退。原生 Agent 在 `ai/tools/index.ts` 注册检索、章节和目录工具，由原研究 Agent 负责预算及证据登记。

| 边界 | 实现 |
| --- | --- |
| 共享工具 | 提取原生 Agent 使用的书籍工具工厂。MCP 的五项方法分发到同一套目录、搜索、章节和上下文逻辑。已授权书 ID 由宿主决定，客户端不能指定其他书。 |
| 生命周期 | 采用 Tauri 管理的回环 Streamable HTTP，沿用 WebView 已初始化的工具，而新建 stdio 进程将需要额外桥接并管理客户端进程。占用随机端口，macOS MLX 开发版明确指定一本书和一个会话 UUID 才启动。 |
| 授权 | 每次启动生成随机短期 bearer token。只接受 127.0.0.1 的 Host，拒绝浏览器 Origin。连接描述符和持久化证据写在专用私有目录。MCP 会话初始化和授权由 Tauri 校验。 |
| 证据 | 复用 EvidenceRegistry 及已有正文结构。保存分配顺序和证据快照，授权 UUID 配合同一本书可在宿主重启后恢复。上下文、索引、章节和证据查询不写书库。 |
| 取消 | 按 MCP 请求 ID 取消，传播宿主超时、断连和会话结束，丢弃过期回复。已经提交给 Metal 的单次推理允许安全收尾。 |
| 联网 | MCP 只注册五项阅读工具，原生 API Agent 的 Parallel 与 24 次预算沿用原路径。 |
| 后续 | 提供统一 Agent Runtime 合同及 Codex App Server 适配计划。Antigravity ACP 保持未启用，等候官方明确支持阅读器集成。 |

测试覆盖原生工具和返回类型兼容、会话授权、非索引回退、PDF/EPUB 引用的适用差异、真实 Codex CLI、重启与 CFI、索引内容对照、授权错误、超时、取消及退出。

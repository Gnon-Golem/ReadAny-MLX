# ReadAny 桌面 Codex 聊天

在 macOS MLX 开发版打开「对话 → Codex」。应用使用本机安装的 Codex CLI 和它的现有登录态。已验证的协议版本随 Codex CLI 0.165.0 提供。

## 构建与使用

按 [macOS 构建说明](macos-mlx.md) 编译。在首次使用前运行 `codex login status` 确认登录状态。若 Codex 不在 Homebrew、常用用户安装路径或应用的 PATH，可在启动开发版时传入 `READANY_CODEX_BIN`，值为可信的 Codex 可执行文件绝对路径。

在新会话中可选一本本地书。点击发送后，ReadAny 才为该会话授权书籍。模型可接收该书的相关片段。会话列表保留历史，选择已有会话后继续提问会恢复对应 Codex thread。响应实时显示，可用消息输入区的停止按钮中断。审批卡列出命令、文件变更或权限请求。允许时核对确认框，拒绝或取消会回传同一请求 ID。允许仅对当前请求或本轮生效。

## 数据与生命周期

- Tauri 用 stdio 管理一个 Codex App Server 子进程，每个会话有专用工作目录。应用保存本地可读消息、书籍授权和 Codex thread ID。历史以私有原子文件 `readany-store/codex-chat-history.json` 写入独立开发数据目录。
- 对授权书籍复用第一期回环 MCP 和证据仓。MCP 令牌只传给 App Server；其命令环境排除令牌。内嵌连接不写出独立 MCP 的连接描述符。
- App Server 合并配置表。ReadAny 在会话启动前读出有效 MCP 列表，在自己的子进程逐一禁用继承项，再校验只启用了本次书籍的 MCP。使用无书会话时检查 MCP 列表为空。用户全局配置文件不写入。
- 线程及回合使用 Codex 用户审批和只读命令沙箱。命令默认网络关闭，网页研究由 Codex 的 `web_search="live"` 处理。嵌入进程关闭 Codex Apps、插件及跨会话记忆。Codex 的命令沙箱读取规则由安装版本提供。单书授权和书籍读取范围由 ReadAny MCP 强制执行。
- 仅将书籍 MCP 已登记的证据 ID 转成现有引用组件。已验证的书籍 CFI 通过通用桌面跳转入口打开。普通 API 对话仍使用原来的模型和 Parallel 联网功能。
- 离开 Codex 面板或退出应用会停止 App Server 并释放授权。继续旧会话不会重新发送上一条提示。

## Mac 验收

MacBook Air M5 上构建并启动 arm64 开发包，签名校验通过。真实 Codex CLI 0.165.0 的默认模型在同一轮完成 Qwen3 向量检索与原生网页搜索。点击书内引用定位到合成 EPUB 的「暂存与心算」。退出并重启后，继续提问恢复到同一个 Codex thread，模型能回忆上一轮的验收代号。再次向量检索前后，样本的三条索引和向量数据库及其 WAL 的校验值一致。

真实 Codex 申请在只读沙箱外创建测试标记时，聊天展示命令和审批原因。点击拒绝后无文件创建。用户批准另一条测试命令后，标记在会话工作目录内生成。打开确认框时没有发送许可，批准响应与原服务端请求 ID 对应。停止用可控的协议端点回归，应用转发 `turn/interrupt` 并保留已生成片段。测试端点无需登录，可用绝对路径传入 `READANY_CODEX_BIN` 指向 `tools/codex-app-server-validation/fixture.py`。发送 `fixture approval` 查看审批，发送 `fixture stop` 后点击停止。用完恢复默认 Codex 可执行文件，测试会话只适用于该端点。

自动检查包括 Rust 20 项、桌面 Codex 2 项、共享 Core 677 项及 Expo 20 项通过，Core 有 1 项跳过。桌面 TypeScript 检查使用项目锁定的 5.8.3 通过。

本阶段覆盖 macOS MLX 开发版和已安装并登录的兼容 Codex CLI。跨设备同步及其他 CLI 协议版本未验证。会话历史存放在该 Mac 的 ReadAny 开发数据目录，恢复时还需要本机 Codex 保存的对应 thread。

## 主要入口

| 文件 | 职责 |
| --- | --- |
| `packages/app/src-tauri/src/codex_app_server.rs` | stdio 生命周期、MCP 配置校验、受限 RPC 和审批响应 |
| `packages/app/src-tauri/src/reading_mcp.rs` | 内嵌授权生命周期、复用只读工具与证据 |
| `packages/app/src/lib/agents/codex-runtime.ts` | 线程恢复、流式事件、取消、来源核对 |
| `packages/app/src/hooks/use-codex-chat.ts` | 会话保存与聊天状态 |
| `packages/app/src/components/chat/CodexChatPanel.tsx` | Codex 聊天、书籍授权和审批 UI |
| `packages/app/src/hooks/use-desktop-citation-navigation.ts` | 原生和 Codex 的共享引用跳转 |

协议依据为 [Codex App Server](https://developers.openai.com/codex/app-server/) 和本机 CLI 生成的 schema。

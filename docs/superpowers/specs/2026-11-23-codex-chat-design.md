# Codex App Server 聊天接入

基于 `feat/desktop-agents` 的 `05e2653d` 和 Mac 上生成的 Codex CLI 0.165.0 JSON Schema。普通 API 聊天与 Codex 会话在同一个桌面聊天入口切换。Reader 的章节定位继续接收现有 Citation 数据。Antigravity 暂不接入。

| 选项 | 设计 |
| --- | --- |
| 宿主 | Tauri 管理安装过的 Codex 二进制，经私有 stdio JSON-RPC。浏览器进程不启动 shell，不经过 App Server daemon |
| 会话 | 聊天模式保存本地显示消息、书籍授权 UUID 与 Codex thread ID。用 thread/start、thread/resume、turn/start 和 turn/interrupt。暂停后不会自动重发用户提示 |
| 展示 | 沿用 MessageList、ChatInput 和桌面引用跳转。根据通知逐项归并文本，区分已完成、停止与失败 |
| 工具 | 由显式选中的当前书授权创建内嵌回环 MCP。用同一书籍网关与 EvidenceRegistry，令牌只在本机 App Server 环境中。显示前重新验证引用 ID。未选书的会话也可使用 Codex 自带网页搜索 |
| 审批 | 只对当前会话的服务端请求显示允许、拒绝和取消。命令、文件改动及请求权限用相应协议结构，以单次或本轮为限。会话关闭时拒绝悬挂请求并停止子进程 |
| 边界 | Codex 从私有会话目录启动，沙箱使用 read-only 和用户审批。按 Codex 已有登录状态运行，保留用户全局配置文件。普通 API 继续使用原有 Parallel 与工具预算 |

原生 MCP 保留独立启动入口。stdio 选用现有二进制并使用官方会话协议，具备会话恢复和请求级审批；反复执行 Codex CLI 单回合命令无法提供同样的稳定交互。验收使用合成 EPUB，覆盖真实 Mac 启动、启动/恢复、流式、停止、审批决策传递和 MCP 证据。

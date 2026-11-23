# ReadAny 桌面 Codex 聊天

在 macOS MLX 开发版的「对话」选择 Codex，也可以打开 EPUB 后在右侧「AI 提问」切换运行时。应用使用本机安装的 Codex CLI 和它的现有登录态。已验证的协议版本随 Codex CLI 0.165.0 提供。

## 构建与使用

按 [macOS 构建说明](macos-mlx.md) 编译。在首次使用前运行 `codex login status` 确认登录状态。若 Codex 不在 Homebrew、常用用户安装路径或应用的 PATH，可在启动开发版时传入 `READANY_CODEX_BIN`，值为可信的 Codex 可执行文件绝对路径。

主页先选择本地书或全局对话，再从对应历史中选会话或新建。点击发送后，ReadAny 才为该会话授权书籍。模型可接收该书的相关片段。会话列表保留历史，选择已有会话后继续提问会恢复对应 Codex thread。响应实时显示，可用消息输入区的停止按钮中断。审批卡列出命令、文件变更或权限请求。允许时核对确认框，拒绝或取消会回传同一请求 ID。允许仅对当前请求或本轮生效。

## 阅读器侧栏

- 「当前书籍」为该会话授权这一本书，ReadAny MCP 按需读取经过登记的证据。「当前章节」在发问时另提供章节索引、标题和当时的阅读位置。
- EPUB 中选中文字，再点击选区菜单的「AI 提问」。选区会先作为可移除的引用卡出现在输入框，发送时才交给 Codex。可在「选中内容」范围提出问题，或选中内容后直接点发送。
- 勾选「附上本章划线和笔记」后，下次发问可带上最多五条本章划线和五条笔记的短摘录。翻页只更新本地位置。书籍、章节、选区模式共用该书会话；「全局对话」使用独立历史及无书籍 MCP 的会话。
- 「在主页继续」保留所选会话和正在生成的消息。在另一会话生成期间仍可浏览历史，发送由同一个 Codex 进程串行处理。切回正在生成的会话可以停止或处理审批。
- 原生 AI 仍使用当前的模型选择、推理选项、历史和 Parallel。Antigravity 选项预留给后续实现，运行时适配器可遵循共享 `AgentRuntime` 协议。

## 数据与生命周期

- Tauri 用 stdio 管理一个 Codex App Server 子进程，每个会话有专用工作目录。应用保存本地可读消息、书籍授权和 Codex thread ID。历史以私有原子文件 `readany-store/codex-chat-history.json` 写入独立开发数据目录。
- 对授权书籍复用第一期回环 MCP 和证据仓。MCP 令牌只传给 App Server；其命令环境排除令牌。内嵌连接不写出独立 MCP 的连接描述符。
- App Server 合并配置表。ReadAny 在会话启动前读出有效 MCP 列表，在自己的子进程逐一禁用继承项，再校验只启用了本次书籍的 MCP。使用无书会话时检查 MCP 列表为空。用户全局配置文件不写入。
- 线程及回合使用 Codex 用户审批和只读命令沙箱。命令默认网络关闭，网页研究由 Codex 的 `web_search="live"` 处理。嵌入进程关闭 Codex Apps、插件及跨会话记忆。Codex 的命令沙箱读取规则由安装版本提供。单书授权和书籍读取范围由 ReadAny MCP 强制执行。
- 仅将书籍 MCP 已登记的证据 ID 转成现有引用组件。点击同书引用在当前阅读器内用 CFI 定位，主页沿用通用桌面跳转入口。普通 API 对话仍使用原来的模型和 Parallel 联网功能。
- 切换页面、书籍或运行时保留正在生成的回合。退出应用会停止 App Server 并释放授权。继续旧会话时恢复保存的 thread。

## 主页基线验收

MacBook Air M5 上构建并启动 arm64 开发包，签名校验通过。真实 Codex CLI 0.165.0 的默认模型在同一轮完成 Qwen3 向量检索与原生网页搜索。点击书内引用定位到合成 EPUB 的「暂存与心算」。退出并重启后，继续提问恢复到同一个 Codex thread，模型能回忆上一轮的验收代号。再次向量检索前后，样本的三条索引和向量数据库及其 WAL 的校验值一致。

真实 Codex 申请在只读沙箱外创建测试标记时，聊天展示命令和审批原因。点击拒绝后无文件创建。用户批准另一条测试命令后，标记在会话工作目录内生成。打开确认框时没有发送许可，批准响应与原服务端请求 ID 对应。停止用可控的协议端点回归，应用转发 `turn/interrupt` 并保留已生成片段。测试端点无需登录，可用绝对路径传入 `READANY_CODEX_BIN` 指向 `tools/codex-app-server-validation/fixture.py`。发送 `fixture approval` 查看审批，发送 `fixture stop` 后点击停止。用完恢复默认 Codex 可执行文件，测试会话只适用于该端点。

自动检查包括 Rust 20 项、桌面 Codex 2 项、共享 Core 677 项及 Expo 20 项通过，Core 有 1 项跳过。桌面 TypeScript 检查使用项目锁定的 5.8.3 通过。

本阶段覆盖 macOS MLX 开发版和已安装并登录的兼容 Codex CLI。跨设备同步及其他 CLI 协议版本未验证。会话历史存放在该 Mac 的 ReadAny 开发数据目录，恢复时还需要本机 Codex 保存的对应 thread。

## 阅读器侧栏验收

MacBook Air M5 的签名开发包验证了以下路径。

| 场景 | 结果 |
| --- | --- |
| 真实 Codex 会话 | 侧栏同一轮完成 Qwen3 本地向量检索和 Codex 原生网页搜索，书籍和网页来源均可点击 |
| 阅读器引用 | 当前 EPUB 内用登记的 CFI 定位到「暂存与心算」 |
| 侧栏与主页续聊 | 从侧栏进入主页后，真实 Codex 能复述原会话的验收代号。可控协议端点确认切换运行时和页面没有启动第二个 thread，主页可对原回合发出停止 |
| 选区与章节 | 侧栏关闭时，从 EPUB 选区菜单唤起 Codex，直接发送选区，无需输入问题。章节范围带有定位信息；划线和笔记请求需要单独勾选 |
| 重启恢复 | 退出应用后重新打开同一本 EPUB，侧栏显示原历史，继续提问时恢复同一 Codex thread 与既有上下文 |
| 原生 AI | 切回原生 AI 后，使用原本配置的 API 模型在同一阅读器响应普通提问；模型与深度思考入口可用 |
| 会话范围 | 两本合成书和无书籍的全局对话使用独立会话。全局 App Server 会话没有书籍 MCP 授权 |
| 工具、审批和停止 | Mac 打包应用的可控协议端点返回真实 MCP 证据；拒绝审批传回原请求 ID；停止保留已显示片段 |
| 索引 | 重复读取前后 `vectors.db` 和 WAL 的校验值一致 |

桌面类型检查通过。桌面 Codex 与上下文测试 5 项、共享 Core 677 项、Expo 20 项通过，Core 有 1 项跳过。Antigravity 还没有运行时实现。Codex 侧栏沿用本机 CLI 的默认模型，原生 AI 继续使用原有模型选择和推理选项。

用法与侧栏布局参考 [LLM for Zotero](https://github.com/yilewang/llm-for-zotero)。

## 主要入口

| 文件 | 职责 |
| --- | --- |
| `packages/app/src-tauri/src/codex_app_server.rs` | stdio 生命周期、MCP 配置校验、受限 RPC 和审批响应 |
| `packages/app/src-tauri/src/reading_mcp.rs` | 内嵌授权生命周期、复用只读工具与证据 |
| `packages/app/src/lib/agents/codex-runtime.ts` | 线程恢复、流式事件、取消、来源核对 |
| `packages/app/src/hooks/use-codex-chat.ts` | 会话保存与聊天状态 |
| `packages/app/src/components/chat/AgentChatPanel.tsx` | 主页和阅读器共用的运行时入口 |
| `packages/app/src/components/chat/CodexChatPanel.tsx` | 共用 Codex 对话、历史筛选、阅读范围及审批 UI |
| `packages/app/src/lib/agents/reader-chat-context.ts` | 发送时选择并限制章节、选区和注释数据 |
| `packages/app/src/hooks/use-desktop-citation-navigation.ts` | 原生和 Codex 的共享引用跳转 |

协议依据为 [Codex App Server](https://developers.openai.com/codex/app-server/) 和本机 CLI 生成的 schema。

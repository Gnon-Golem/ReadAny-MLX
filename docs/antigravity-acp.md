# ReadAny macOS 的 Antigravity ACP

打开 macOS MLX 开发版「对话」，或在 EPUB 阅读器右侧打开「AI 提问」，在运行时菜单选择 Antigravity。ReadAny 查找已安装并通过官方流程登录的 `agy`。如果需要指定本机安装路径，用可信可执行文件的绝对路径设置 `READANY_AGY_BIN`，从当前 shell 启动应用。构建步骤见 [macOS MLX](macos-mlx.md)。

「连接并选择模型」用于在首次发问前读取实际会话配置。模型和思考等级取自 ACP 的 `configOptions`；通用个人客户端仅显示 Gemini 选项。选择书籍、章节、选区或全局范围，按需附上本章短笔记。书籍引用通过 ReadAny MCP 返回的证据编号校验，可以跳回 EPUB。主页和侧栏共用同一 Antigravity 会话，Codex 的历史保存在独立文件。

## 权限档位

| 档位 | 行为 |
| --- | --- |
| 逐次审批 | 保留终端沙箱，每条命令与受保护的文件、MCP、网页操作询问 |
| 默认 | 常规命令在沙箱内运行，越界或敏感操作询问 |
| 自动 | 保留终端沙箱，使用官方 CLI 的 Auto 决策能力，需当前 CLI 和账号支持 |
| 完全访问 | 关闭终端沙箱，授权当前会话执行 CLI 允许的文件、终端、联网及 MCP 操作。ReadAny 自动选择 CLI 提供的单次许可。系统权限和 CLI 的硬性拒绝仍生效 |

每个会话保存最后选择，重启应用或在主页和阅读器之间切换时沿用。新会话预选最近的档位；预选完全访问时，开始连接或发送前需为新会话单独确认一次。历史记录缺少权限字段时使用默认档。切换当前会话档位会关闭该 ACP 连接，下次使用以新档位恢复原会话。读书 MCP 的单书授权独立管理；完全访问下，CLI 可通过本地文件功能访问当前 macOS 账户原本有权访问的书库文件。

## 进程、读书权限和数据

- ReadAny 使用官方 CLI 的 `agy acp` 标准输入输出和 ACP v1。初始化成功后创建或恢复会话。支持 `resume` 时优先使用；版本只支持 `load` 时用 `load`，本地已有对话不重复导入。身份认证由 CLI 管理。
- 权限菜单按会话设置 CLI 的权限、执行模式和终端沙箱。官方 ACP 的会话子进程仍可能请求许可。已确认的完全访问会话直接答复官方提供的单次许可，其他档位由用户处理。已有书籍授权仍按会话管理。 [CLI 配置参考](https://antigravity.google/docs/cli/reference#configuration-keys-settingsjson)
- 书籍会话在 HTTP MCP 能力协商通过后，使用 `--process-per-session` 将单书回环 MCP 注册给当前 ACP 会话。令牌通过 ACP 传给官方进程，禁止写入 ReadAny 历史或配置。独立监听器按会话发放授权，继续以现有证据仓、RAG 和向量库读取书籍。全局会话没有由 ReadAny 注册的书籍工具。
- 只给 ACP 提供 ReadAny 的五项只读书籍工具。联网由 Antigravity 使用它自己的工具；普通 API 对话继续支持原生的 Parallel。默认指引禁止将书籍摘录、选区和笔记当成公开搜索词，用户可明确提出例外。选择发送的片段可能交给 Antigravity 模型。
- Antigravity 本地历史以私有文件 `readany-store/antigravity-chat-history.json` 存在开发版数据目录。继续旧会话还依赖本机 CLI 会话数据。运行中的回合可以停止，退出会关闭 ACP 进程和书籍授权。

## 适用范围

Google 的 ACP 文档支持直接启动原版 CLI 的交互式客户端。开发者论坛答复明确包括由真人直接操作的自定义界面，同时限制用消费者登录做后台委派、自动任务队列、模型代理和 OAuth 转发。ReadAny 在阅读器内提供面对用户的交互对话。Google 未单独认证 ReadAny；账号条款、可用模型、配额和客户端可用功能以官方说明和现场协商为准。 [ACP 文档](https://antigravity.google/docs/ide/extensions/acp/) · [自定义客户端答复](https://discuss.ai.google.dev/t/policy-question-omp-hosting-unmodified-antigravity-acp-for-one-user/199753/2) · [附加条款](https://www.antigravity.google/terms)

## 验证

- Mac 的真实对话由已登录的用户在阅读器发送。Antigravity 在同一轮完成 Qwen3 单书向量检索并登记 EPUB CFI，再用自带网页搜索返回 Apple Newsroom 官方链接。点击引用在原阅读器内定位。转到主页并重启应用后，用户继续发问，官方 ACP 在同一会话中正确复述首轮验收代号。检索前后既有向量库与 WAL 校验值一致。
- 真实官方 CLI 1.5.15 验证了 ACP v1、已登录会话初始化、动态模型和思考选项、配置修改，以及重启 ACP 进程后的 `session/resume`。独立回环探针验证 HTTP MCP 认证头、工具发现与配置隔离。探针令牌未在本次检查的新增日志或会话文件中检出。
- Mac 签名包配合模拟 ACP 端点验证侧栏、多轮和流式、审批拒绝、跨页面停止、应用重启恢复、模型配置与全局无书授权。模拟 ACP 连接了真实 ReadAny MCP，并用登记的 CFI 跳到合成 EPUB 原文。Codex 和 ACP 各自使用真实本地 MCP，原生 AI 通过现有 API 配置完成普通问答。
- 权限菜单在签名开发包上使用模拟 ACP 验证。逐次审批切到完全访问后续接同一会话，退出再打开仍沿用完全访问。新会话预选该档位并要求确认，旧 Mode 菜单已消失。
- 官方 CLI 1.5.15 真机复测时，用户在重启后恢复原会话并手动发送合成书问题。完全访问下，ReadAny 向量检索和无副作用的 `printf` 命令均完成，没有显示审批，仍返回已登记的 EPUB CFI 引用。
- 本次权限改动通过 Rust 25 项、桌面 Agent 9 项和共享 Core 677 项测试，Core 1 项跳过。桌面类型检查通过。

## 主要改动

| 文件 | 职责 |
| --- | --- |
| `packages/app/src-tauri/src/antigravity_acp.rs` | 官方进程、标准 ACP 消息、运行时设置、审批、授权和历史 |
| `packages/app/src/lib/agents/antigravity-runtime.ts` | ACP 能力协商、配置、会话恢复、流式通知及取消 |
| `packages/app/src/hooks/use-agent-chat.ts` | 每个运行时独立的会话控制器 |
| `packages/app/src/components/chat/ExternalAgentChatPanel.tsx` | 共用的运行时配置、消息、审批、上下文与引用 |
| `packages/app/src-tauri/src/reading_mcp.rs` | 为独立的 Codex 和 Antigravity 会话发放 MCP 授权 |

可控协议端点可以用 `READANY_AGY_BIN` 指向 `tools/antigravity-acp-validation/fixture.py`。使用 `fixture cite` 测试真实本地 MCP，`fixture approval` 测试审批，`fixture stop` 测试取消。该端点不使用 Google 账号，测试会话需与真实会话区分。

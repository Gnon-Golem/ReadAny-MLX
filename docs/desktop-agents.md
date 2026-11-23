# 桌面阅读工具与外部 Agent

第一期在 macOS MLX 开发版提供经单书授权的只读 MCP。工具经过应用当前的 Core、书库、索引来源和向量模型。详情见[基线审计](superpowers/specs/2026-11-23-desktop-mcp-design.md)。

## 构建并授权

按 [macOS 构建说明](macos-mlx.md) 生成 arm64 开发包。使用 Bash 或 zsh，退出此前打开的开发版后从仓库根目录运行：

```sh
app="$PWD/packages/app/src-tauri/target/release/bundle/macos/ReadAny MLX Dev.app"
book_id='在此填写明确授权的书籍 ID'
reading_session="$(uuidgen)"
open -n "$app" --args "--readany-mcp-book=$book_id" "--readany-mcp-session=$reading_session"
```

正常启动时 MCP 关闭。两个参数同时存在才授权，已配置且指向同一开发库的 ReadAny CLI 可用 `readany books list --json` 查书籍 ID。需更换书籍时退出应用并创建新 UUID。重开同一书籍与 UUID 可恢复该逻辑会话的证据，每次启动都会更换端口和 bearer token。

应用在 `~/Library/Application Support/com.readany.mlx.macos.dev/desktop-mcp/connection.json` 写入权限为 0600 的描述符。目录权限为 0700。描述符包含 URL、bearer token、书籍与会话 ID。请将令牌保留在本机环境变量中。退出应用会关闭服务并删除描述符。若宿主被强制终止，旧描述符的地址和认证已失效，下次授权启动会写入新描述符。

## 用现有 Codex CLI 连接

下面用已有登录态和一次性的命令覆盖，避免编辑全局配置。需要 `python3`。请把测试提示换成该授权书籍中的内容。

```sh
descriptor="$HOME/Library/Application Support/com.readany.mlx.macos.dev/desktop-mcp/connection.json"
reading_url="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$descriptor")"
export READANY_MCP_TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$descriptor")"
codex exec --ignore-user-config --skip-git-repo-check --sandbox read-only --ephemeral \
  -c "mcp_servers.readany.url=\"$reading_url\"" \
  -c 'mcp_servers.readany.bearer_token_env_var="READANY_MCP_TOKEN"' \
  -c 'mcp_servers.readany.required=true' -c 'mcp_servers.readany.tool_timeout_sec=55' \
  '只用 ReadAny MCP 获取书籍上下文、目录和相关段落，再查询返回的 evidenceId。'
unset READANY_MCP_TOKEN
```

授权书中的内容可进入你连接的模型会话。若 ReadAny 选中远程 Embedding，向量查询使用该配置生成查询向量。验证程序可直接检查协议和结果：

```sh
python3 tools/desktop-mcp-validation/smoke.py "$descriptor" --query '工作记忆'
```

## 工具与数据边界

| 工具 | 输出 |
| --- | --- |
| `readany_get_context` | 授权书籍的元数据、同书当前位置和索引身份 |
| `readany_search_book` | Core 的 BM25、向量或混合结果，含命中章节、chunk ID 和 CFI。无索引时由原文件回退，返回 `keyword-fallback` |
| `readany_read_chapter` | 既有章节工具的有界正文与来源 |
| `readany_get_toc` | 可分页和关键词过滤的目录 |
| `readany_get_evidence` | 通过同一授权会话已发出的 ID 读取书籍证据和引用字段 |

首次连接协商 MCP 2025-11-25、2025-06-18 或 2025-03-26，随后请求携带 MCP 会话 ID 与 bearer token。每个应用实例显式授权一本书，不提供列举书库、SQL、任意文件读取或写入工具。请求最多等待 45 秒。客户端取消、会话删除或 ReadAny 退出会放弃对应请求，已提交的单次 Metal 运算可安全结束。持久证据包含真实 CFI 的简短片段和引用字段，按授权 UUID 写到私有目录，最多 512 项。证据 ID 只在同一书籍的授权会话中有效。原生 API 研究继续使用现有 Parallel 和 24 次预算。外部 Agent 自行处理联网。

## 本机验收

在 MacBook Air M5 的 arm64 开发包中完成了以下检查。

| 检查 | 结果 |
| --- | --- |
| Codex CLI 0.165.0 | 已登录的 CLI 完成同一轮全部五项 MCP 工具调用。模型收到的书籍数据来自合成 EPUB |
| 已索引书籍 | 使用现有 2560 维 Qwen3 索引命中「暂存与心算」。重复查询复用 `book-1`。用原 EPUB 的 spine 和文档文本解析 MCP 返回的 CFI，定位到第二章的原文标题 |
| 非索引书籍 | 第二本合成 EPUB 通过书库导入。语义模式请求返回带真实 EPUB 位置的关键词回退，书籍保持未索引 |
| 数据回归 | Codex 调用、取消、超时、重启和原文件回退前后，本地向量索引各表的行数与内容 SHA-256 一致 |
| 授权与生命周期 | 错误 token、浏览器 Origin、缺失会话、跨书参数及伪造证据均被拒绝。退出后连接描述符移除，旧端口关闭。同一书籍和授权 UUID 重启后，首次工具查询即可查到原证据。正常启动关闭 MCP |
| 取消和超时 | 暂停测试实例的 MLX Sidecar 后发送 MCP 取消通知，请求立即结束。另一请求在约 45 秒超时。恢复 Sidecar 后，两个过期请求均未写入证据 |
| 回归测试 | Core 678 项（含真实 Parallel）、Rust 18 项、Expo 20 项通过，桌面类型检查通过 |

首期使用单书授权。Mac 实机、证据和位置验证使用 EPUB。外部运行时目前通过 CLI 连接，内嵌聊天和多书授权留待后续开发。

## 第二期方案

| 模块和文件 | 预计变更 |
| --- | --- |
| `packages/core/src/ai/agent-runtime.ts` | 已定义会话、流事件、引用证据、取消和审批接口。后续两个适配器使用同一合同 |
| `packages/app/src-tauri/src/codex_app_server.rs` 与 `lib.rs` | 管理精确版本的 `codex app-server --listen stdio://` 子进程和 JSON-RPC。执行 `initialize` / `initialized`，用 `thread/start` / `thread/resume` 和 `turn/start` / `turn/interrupt`，维护请求 ID、错误、退出与重连。锁定已验证的协议 schema，可用 CLI 生成绑定 |
| `packages/app/src/lib/agents/codex-runtime.ts` | 按 thread、turn 和 item ID 归并事件，将 `item/agentMessage/delta`、工具状态和 `turn/completed` 映射成统一事件；持久化外部 thread ID 与本地书籍授权 ID 的配对。重复事件幂等处理 |
| `packages/app/src/hooks/use-streaming-chat.ts`、`ChatPage.tsx`、`ReaderView.tsx` | 后续添加运行时选择、流式显示、停止、审批卡片及状态恢复。只将本地证据仓中验证过的 ID 转换成现有引用组件数据 |
| `packages/app/src/components/settings/ExternalAISettings.tsx` | 后续提供授权书选择、登录状态和原生联网开关。用 Codex 运行时的 Web 功能，ReadAny MCP 仍只提供书籍工具 |

阶段二的审批需要将命令、文件变更和权限请求交给真实用户，以原请求 ID 回答，并在超时或关闭时拒绝/取消。对模型工具访问执行最小授权，把 Codex 的工作目录与 ReadAny 用户数据目录隔离。会话恢复只保存运行时 ID 和必要的本地引用映射，账号凭据继续由 Codex 管理。协议以实际安装版本生成的 schema 和官方指南为准。 [Codex App Server 协议](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

Google 文档将 `agy acp` 描述为 ACP 编辑器的编码代理接口。FAQ 说明消费者方案不支持把 headless CLI 包装进第三方应用，并对未经支持的第三方登录接入有限制。在该官方范围内尚未找到对 ReadAny 这类非编辑器阅读应用的明确支持。本期只保留接口，后续应先取得适用于该宿主和账户类型的官方许可或支持依据。 [ACP 编辑器文档](https://antigravity.google/docs/ide/extensions/acp/) · [Google Antigravity FAQ](https://antigravity.google/docs/faq/)

参考现有项目的运行态工具桥设计。 [LLM for Zotero](https://github.com/yilewang/llm-for-zotero) · [ZotSeek MCP](https://github.com/introfini/ZotSeek/blob/main/docs/MCP.md)

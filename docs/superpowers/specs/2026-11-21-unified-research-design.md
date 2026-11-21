# ReadAny MLX 联网与统一研究

## Phase 0 核对

稳定版 `mlx-ios` 固定于 `29a5b473a62d1eca42a5b58cb64885bb4a00f3a1`。本机标记 `stable/mlx-ios-before-unified-research`。该提交相对 328971a1 只更新 README。既有真机验收来自原 Xcode 签名版。本任务使用隔离工作树及 `feat/unified-research`，不改稳定版或推送。

[上游 PR #852](https://github.com/codedogQBY/ReadAny/pull/852) 使用桌面平台 fetch、独立旧 Search MCP 地址和 Node MCP SDK。联网结果使用普通 Markdown 链接。它没有 Expo 支持或注册式网页引用。新版 [Parallel MCP](https://docs.parallel.ai/integrations/mcp/quickstart) 免 Key、低额度、默认 fast；本机已验证 `?tools=web_search,web_fetch`、2025-11-25 协商、含会话标头的 SSE、202 通知响应、工具列表和真实搜索与抽取。搜索限制由本地结果裁剪，匿名连接不能假定服务端支持覆盖结果数。

Core 的 `ai/agents/reading-agent.ts` 同时处理阅读范围、工具过滤和 ReAct。现有总上限 12，章节上限 8，定位上限 3，重复上限 2，通常递归上限 24。额度在缓存读取前扣减。 `ai/tools/index.ts` 根据索引状态注册 RAG 或 fallback； `context-tools.ts` 与 `reading-context-service.ts` 提供选区和章节。 `ai/streaming.ts` 转发取消和工具事件，桌面与共享 hook 都有调用点。

Expo 的 `lib/platform/expo-platform-service.ts` 网络方法使用 XHR，适合既有 WebDAV 路径。研究将选用 Expo 54 的流式 fetch 注入 Core，单独检查重定向策略、AbortSignal、后台取消及恢复。Mac 使用标准流式 fetch。真实硬件目前不可用，Mac 与模拟器结果各自记录。

## 接入选择

使用小型 Streamable HTTP 客户端，支持协商、初始化通知、工具发现、JSON 或 SSE、会话标头、响应限长与取消。只访问固定 Parallel 地址。保留可注入 fetch，使 Core 既能走标准实现，也能使用原生适配器。桌面 SDK 能复用更多协议，但在该基线的 Expo 分支会增加依赖与运行时兼容面。REST 适合作为有认证配置的备选。代理只有在公开 API 无法直连时再评估。

网页读取由 Parallel 执行。客户端只接受公共 DNS 形式的 HTTPS URL，拒绝 IP、凭据、特殊端口和保留名称，不在应用中直接请求网页目标或跟随输出中的链接。MCP 传输拒绝重定向。Parallel 负责其服务端 DNS 解析和跳转。阶段三将进一步要求 fetch 目标来自本轮注册结果或用户明确提供的 URL。网页文本只作为不可信资料。联网回合仅绑定只读研究工具；修改书库或笔记必须走独立的用户操作。联网默认关闭，搜索只提交有界查询，不附加书籍、选区、历史或凭据。

## 阶段与文件入口

| 阶段 | 实际入口与边界 | 验收与回退 |
| --- | --- | --- |
| 1 | `core/src/ai/research` 实现有类型的 Provider 和两项工具。Expo 流式 fetch 适配及独立探针验证；常规聊天尚不注册。 | Mock 协议、URL、取消、限长、限流等；Mac 真实两项工具；iPad 真机及 AppState。阶段提交可单独 revert。 |
| 2 | `reading-agent.ts`、`tools/index.ts`、`system-prompt.ts`、`streaming.ts` 与共享 `hooks/use-streaming-chat.ts`。阅读范围沿用现有上下文分类；另算搜索来源。总限额 24，Local 14/章节 12/定位 4，搜索 4/网页读取 6，重复最多 3 次真实尝试，复杂轮递归 64。先同步预留额度，包含失败和并行，再在 16 次软阈值鼓励总结。保留旧 addCitation 通路。 | Local、Web、Hybrid、Off 零请求、失败回落、缓存及并发容量，验证真实 ReAct 步数和总结路径。 |
| 3 | `types/message.ts`、`types/chat.ts`、`tools/annotation-tools.ts`、`streaming.ts` 和 `utils/chat-utils.ts`。每轮 Registry 验证来源、去重、稳定 ID、编号、限制 12；已有书籍原文和 CFI 验证延用。 | 真书/假 ID、预算耗尽后的引用、旧消息和网页来源往返。 |
| 4 | Expo `stores/settings-store.ts`、`screens/settings/AISettingsScreen.tsx`、`screens/BookChatScreen.tsx`、`components/chat/PartRenderer.tsx` 、`MarkdownRenderer.tsx` 与 `MessageList.tsx`。设置、模式、联网状态、失败、取消和打开已登记 URL。防剧透开启时默认约束剧情相关查询和展示。 | 重启恢复、点击书籍/网页、断网和后台、阅读并行。 |
| 5 | Core 研究会话内短缓存与双来源配额；按各自内部名次融合。在工具输出、证据、阅读上下文和最终回答各设预算，保留来源元数据。 | 缓存不进入 SQLite、效期/大小/取消、基本质量与延迟比较；网页 MLX 重排可选。 |
| 6 | `db/message-queries.ts`、`utils/chat-export.ts`、`sync/per-book-sync.ts`、平台同步适配器、桌面聊天/笔记入口。 | 带来源的导出与笔记、旧/新同步测试、Mac Core 复用。 |

## 数据兼容与恢复

现有持久化对象是 `Message`。 `citations`、`tool_calls` 和 `parts_order` 都是 JSON 文本， `per-book-sync.ts` 同步消息行。因此在兼容测试前保持 schema，不为网页造假 bookId 或 CFI。保留旧书籍数组语义，评估以扩展渲染部件 JSON 保存简短网页元数据，使旧客户端忽略未知部件并保留既有聊天正文。严格核对旧客户端重写的行为。网页内容仅在内存，请求和完整响应不进入已同步 `tool_calls`。若需要 schema 迁移，先建立 SQLite 一致备份并复制用测试数据，在迁移前验证旧版本可打开及可恢复演练，然后才接触用户库。

每阶段先跑目标用例，再跑已有 `pnpm test`、`pnpm lint`、Expo 测试和相关类型检查。比较基线 lint。公开网络验证只使用非私有问题和公共来源。设备验收前核实开发签名和现有数据，优先以独立探针运行 Phase 1。后续构建沿用 MLX 变体，若安装会覆盖设备上的稳定版本，先停下确认数据与恢复路径。

## Phase 1 验证入口

`packages/core/src/ai/research/parallel-provider.test.ts` 默认使用 Mock。设置 `READANY_TEST_LIVE_PARALLEL=1` 后运行同一测试文件，将额外执行一次匿名真实搜索和网页读取。程序仅查询公开的 Apple Metal 样例资料。

常规 Expo 打包使用现有入口。在隔离测试构建时，设置 `EXPO_PUBLIC_PARALLEL_PROBE=1` 和单独的已授权测试 Bundle ID，再用原 MLX 变体流程构建。启动会对样例搜索和读取各执行一次，将结果写入探针容器内的 `Documents/parallel-probe-result.json`。界面也可单独搜索、读取或取消。关闭网络后再次运行，确认显示失败；恢复网络后再次运行，确认应用可重新建立 MCP 会话。进行中的请求进入后台时会取消。正常聊天阶段仍未启用网络工具。iPad 首次遇到 429。复用同一 MCP 会话和匿名关联标识后，实机同一轮返回三条来源并读取了公开页面；其他网络仍可能限流。匿名服务失败时保留明确的错误分类。

## 当前实现与边界

iPad 和桌面端的 AI 设置均提供 Off、Auto、Always。默认 Off。防剧透开启时，与书籍内容有关的研究保留本地路径。匿名 Parallel 可能限流，App 展示失败状态，已有本地证据仍可用于回答。搜索与网页读取复用每轮 MCP 会话。当前只接受公共 HTTPS 链接，并且限定网页读取来源为本轮检索结果或用户明确提供的地址。目标域名解析与远端网页跳转由 Parallel 执行。

研究证据按本地与网页分别分配上下文配额。各来源保留自身返回顺序及可用分数，约束重复域名、章节与跟踪参数重复 URL。首次版本用文本估算 token，中文按较保守规则计算。历史上下文、书籍摘录、网页摘录和中间结果分别限量，回答使用已有模型输出配置。缓存最多 32 项，仅驻留进程内，默认搜索 90 秒、网页读取 240 秒、空结果 20 秒，保留原检索时间。缓存、请求和网页正文不会随聊天同步。网页语义重排仍为可选增强。

研究回答引用以真实证据 ID 映射到编号，最多 12 项。已保存网页引用走现有 `parts_order` JSON 列，可导出为 Markdown、JSON 或纯文本。在联合回答中，可将网页来源保存为第一条有效书籍 CFI 上的高亮附注，并在该附注中记录聊天消息关系。保存前会确认有效来源与书籍位置；同位置已有笔记时追加。没有可验证 EPUB 位置的回答仍可打开和导出网页来源。没有数据库迁移。旧版客户端可保留聊天文本与书籍引用，对网页引用的渲染需要本次更新。

同步回归用两份独立数据库替身和现有 WebDAV 存储接口做推送、拉取，核对消息的 JSON 部件和书籍附注。真机验收用隔离 iPad 应用、原创 EPUB、实际 Q8 与真实 Parallel，生成器为设备内测试模型。Mac 通过独立实网协议测试与桌面前端构建。个人 WebDAV 服务器、真实跨设备 UI 同步、商业聊天模型回答质量和可选 MLX 网页重排不在已确认验收范围。

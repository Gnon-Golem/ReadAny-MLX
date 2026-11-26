# 开发路线

[中文首页](../../README.md) · [文档索引](README.md) · [English](#english)

## 待验证工作

1. 在实体 iPad 上从公开链接下载、校验并侧载两份 IPA，记录 SideStore 首装、续签和 Increased Memory Limit 是否保留。分别记录 Xcode 签名版和公开 IPA 的结果。
2. 扩大 Apple Silicon 设备和内存配置的覆盖，使用长篇 EPUB 及更大的藏书样本，测量索引时间、内存和查询延迟。提供可公开的样本、命令和原始统计。
3. 用可公开的 EPUB 验证 iPad 和 Mac 的真实 WebDAV 同步，以及各产品分支的多轮研究、引用回跳和会话恢复。分别记录真实服务与协议测试端点的结果。
4. 为四个场景补齐可公开的真实界面，并记录拍摄所用分支和构建版本。当前实测范围见[验收记录](verification.md)。

## 产品截图计划

| 场景 | 推荐构图 |
| :--- | :--- |
| iPad 本地 MLX | 横屏显示可公开的 EPUB 原文与原生 AI 阅读助手，画面中保留提问、书内引用与对应正文。 |
| macOS 本地 MLX | 先截取 Qwen3 Q8 已加载的模型面板，再截取同一本示例 EPUB 的语义和混合检索结果。 |
| Codex 阅读器侧栏 | 同屏展示 Codex 运行时、单书问题、编号引用和点击后定位到的原文。 |
| Antigravity 联合研究 | 在阅读器侧栏展示同一轮回答的书内引用和公开网页引用，并保留 EPUB 对应章节。 |

截图使用合成或可公开的书籍及笔记。发布前检查账号标识、API Key、私有书名和正文、笔记、文件路径和通知。

## English

[English home](../../README.en.md) · [Documentation index](README.md#english) · [简体中文](#开发路线)

### Pending verification

1. Download and verify both public IPAs and sideload them on physical iPads. Record SideStore installation, renewal, and whether the Increased Memory Limit entitlement is retained. Record results for the public IPAs and Xcode-signed builds separately.
2. Cover more Apple Silicon devices and memory configurations. Use long EPUBs and larger libraries to measure indexing time, memory use, and query latency. Publish shareable fixtures, commands, and measurement results.
3. Verify live WebDAV sync across iPad and Mac, and test multi-turn research, citation navigation, and session recovery using shareable EPUBs. Report results from live services and controlled protocol endpoints separately.
4. Capture four real product scenes and record the branch and build used for each. [Current verification coverage](verification.md#english)

### Product screenshots

| Scene | Suggested composition |
| :--- | :--- |
| iPad local MLX | A landscape view of a shareable EPUB and the built-in assistant, with the question, citation, and corresponding passage visible. |
| macOS local MLX | Show Qwen3 Q8 loaded in the model panel, then capture semantic and hybrid search results for the same sample EPUB. |
| Codex reader sidebar | Show the Codex runtime, a book question, a numbered citation, and the passage it opens. |
| Antigravity joint research | In one reader sidebar turn, show both a book citation and a public web citation with the relevant EPUB chapter visible. |

Use synthetic or shareable books and notes. Before publishing, check for account identifiers, API keys, private titles or excerpts, notes, local paths, and notifications.

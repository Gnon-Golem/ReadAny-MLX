# 性能与实机验证

[中文首页](../../README.md) · [文档索引](README.md) · [English](#english)

## iPad 向量探针

iPad Pro 11 英寸 M5（12 GB），iPadOS 27.3，Xcode 27.2 Release 构建。模型为[固定版本的 Qwen3-Embedding-4B Q8](configuration.md#向量模型)，词元长度包含终止符。探针在 Metal 上逐条运行，连续样本每次提交一个输入。[探针源码和复现步骤](https://github.com/Gnon-Golem/ReadAny-MLX/tree/mlx-ios/tools/qwen3-mlx-validation)

| 项目 | 本次测量 |
| :--- | ---: |
| 权重加载 | 1.313 s |
| 首条推理，256 token，含首次运行开销 | 2.413 s |
| 单条推理，512 token / 1,024 token | 385 ms / 752 ms |
| 连续 100 条，每条 256 token | 中位 221 ms / P95 226 ms / 总计 22.156 s |
| MLX 峰值 / 系统进程 footprint 峰值 | 4,589 MiB / 4,761 MiB |

另一次 MacBook Air M5 探针验收使用相同权重比较 Swift 与 Python MLX。9 条输入的 token ID 全部一致，最低向量余弦相似度为 0.99999432。[分支实测记录](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/README.md#实测与兼容性)

## 签名开发包与真实服务

| 环境 | 实际结果与范围 |
| :--- | :--- |
| **iPad Pro M5，Xcode 签名版** | 短篇合成 EPUB 生成三个 2,560 维向量。断网下完成语义与混合检索、CFI 跳转并保留旧 ONNX 索引。切至后台后返回可恢复查询。单独这轮应用实测峰值约 4.44 GiB。已验证原生研究助手在启用 Parallel 后同轮调用书内和网页工具。[iPad 产品指南](https://github.com/Gnon-Golem/ReadAny-MLX/tree/mlx-ios) |
| **MacBook Air M5（16 GB），macOS 27.3，Xcode 27.2** | arm64 基础版验证 Q8 导入、加载和卸载，短篇合成 EPUB 的三个向量分块，BM25、语义和混合检索，重启后 CFI 跳转及原有 ONNX 路径。真实 Parallel 研究回合搭配本地可控聊天端点。网页读取首次遇到 429，重试后拿到摘录。[macOS 验收表](https://github.com/Gnon-Golem/ReadAny-MLX/blob/macos-mlx/docs/macos-mlx.md) |
| **同一台 Mac，Codex CLI 0.165.0** | 已登录的 Codex 在同一轮完成书内向量检索和原生网页搜索，验证 CFI、应用重启后恢复同一 thread，以及批准和拒绝。中断通过可控协议端点验证。[Codex 验收](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/codex-chat.md) |
| **同一台 Mac，Antigravity CLI 1.5.15** | 已登录的 Antigravity 在同一轮完成书内向量检索和原生网页搜索，验证 CFI、阅读器转主页并重启后续聊。ACP v1 初始化和进程重启后的恢复使用官方 CLI 验证。停止、拒绝及部分侧栏流程另用可控协议端点验证。[Antigravity 验收](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/antigravity-acp.md) |

## 公开下载与覆盖范围

2026 年 11 月 26 日，从公开链接下载了两份 IPA，并逐一核对完整文件的 SHA-256 和源码提交。发布 IPA 的 SideStore 首装、续签和 Increased Memory Limit 权限保留仍待设备验证。当前报告覆盖指定 M5 设备、短篇合成 EPUB 和记录的 CLI 版本。其他芯片和内存配置、长书或大型书库、真实跨设备 WebDAV 同步及聊天服务的普遍表现待验证。[下载与校验方法](build.md#校验并侧载-ipad-ipa)

## English

[English home](../../README.en.md) · [Documentation index](README.md#english) · [简体中文](#性能与实机验证)

### iPad embedding probe

Release probe built with Xcode 27.2 for an 11-inch iPad Pro M5 with 12 GB RAM, running iPadOS 27.3. Tests use the [pinned Qwen3-Embedding-4B Q8 weights](configuration.md#embedding-model). Token counts include the end token and each input is submitted individually on Metal. [Probe source and reproduction steps](https://github.com/Gnon-Golem/ReadAny-MLX/tree/mlx-ios/tools/qwen3-mlx-validation)

| Test | Observed result |
| :--- | ---: |
| Model load | 1.313 s |
| First 256-token inference, including first-run overhead | 2.413 s |
| Single 512-token / 1,024-token inference | 385 ms / 752 ms |
| 100 sequential inputs, 256 tokens each | 221 ms median / 226 ms P95 / 22.156 s total |
| Peak MLX allocation / peak system process footprint | 4,589 MiB / 4,761 MiB |

A separate MacBook Air M5 probe compared Swift and Python MLX using the same weights. Token IDs matched on all nine inputs, and the lowest vector cosine similarity was 0.99999432. [Edition verification record](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/README.md#实测与兼容性)

### Signed development apps and live services

| Environment | Observed result and scope |
| :--- | :--- |
| **iPad Pro M5, Xcode-signed app** | A short synthetic EPUB produced three 2,560-dimensional vectors. Offline semantic and hybrid retrieval, CFI navigation, and the existing ONNX index worked. Queries resumed after leaving and reopening the foreground. This separate app run peaked at about 4.44 GiB. With Parallel enabled, the built-in assistant used book and web tools in the same turn. [iPad edition guide](https://github.com/Gnon-Golem/ReadAny-MLX/tree/mlx-ios) |
| **MacBook Air M5 (16 GB), macOS 27.3, Xcode 27.2** | The arm64 base edition verified Q8 import, load and unload, three indexed passages from a short synthetic EPUB, BM25, semantic and hybrid retrieval, CFI navigation after restart, and the existing ONNX path. A live Parallel research turn used a controlled local chat endpoint. A web fetch returned HTTP 429 first and yielded an excerpt after a retry. [Mac verification](https://github.com/Gnon-Golem/ReadAny-MLX/blob/macos-mlx/docs/macos-mlx.md) |
| **Same Mac, Codex CLI 0.165.0** | A signed-in Codex session used book vector search and its own web search in the same turn. CFI navigation, resuming the original thread after restarting the app, and approval and denial were tested. Interrupt handling used a controlled protocol endpoint. [Codex verification](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/codex-chat.md) |
| **Same Mac, Antigravity CLI 1.5.15** | A signed-in Antigravity session used book vector search and its own web search in the same turn. CFI navigation and resuming from the reader to home across a restart passed. The official CLI was used to verify ACP v1 initialization and process restart recovery. Cancellation, denial, and some sidebar flows used a controlled protocol endpoint. [Antigravity verification](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/antigravity-acp.md) |

### Public packages and coverage

Both public IPAs were downloaded in full on November 26, 2026, and checked against the published SHA-256 files and corresponding source commits. SideStore installation, renewal, and retention of the Increased Memory Limit entitlement in the published IPAs still need device verification. This report covers the listed M5 devices, short synthetic EPUBs, and stated CLI versions. Other chips and memory configurations, long books and large libraries, live cross-device WebDAV sync, and broader chat provider performance are pending. [Download and verification steps](build.md#verify-and-sideload-an-ipad-ipa)

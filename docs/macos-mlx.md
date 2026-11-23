# ReadAny MLX macOS 开发版

基于 `feat/unified-research` 的 ReadAny 1.3.7。移植差异见 [审计报告](superpowers/specs/2026-11-23-macos-mlx-design.md)。

## 构建和启动

需要 Apple Silicon、Xcode 及 Metal Toolchain、Node 22、pnpm 9.15.0 和 Rust stable。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
APPLE_SIGNING_IDENTITY=- pnpm tauri build --bundles app
open "packages/app/src-tauri/target/release/bundle/macos/ReadAny MLX Dev.app"
```

上述命令生成 ad-hoc 签名的本机开发包。使用 `pnpm tauri dev` 可启动开发服务器和 Tauri，开发端口为 1430。Xcode 在构建前编译 Swift Sidecar，并把它与 Metal 库放入应用包。需要指定 Swift 构建缓存时，将 `READANY_MLX_DERIVED_DATA` 设为绝对路径。

| 运行配置 | 值 |
| --- | --- |
| 应用标识 | `com.readany.mlx.macos.dev` |
| 默认资料库、设置和索引 | `~/Library/Application Support/com.readany.mlx.macos.dev` |
| 已验证的模型文件 | 应用资料库下的 `ReadAnyModels/Qwen3Embedding4BMLXQ8` |
| 更新 | 禁用官方 Release 检查和安装 |
| 正式版 | 可用独立应用标识 `com.readany.app` 并行安装 |

## 模型和检索

1. 打开「设置 → 向量模型 → 内置本地模型」。
2. 选择「导入模型文件夹」，定位已有的 `majentik/Qwen3-Embedding-4B-MLX-8bit` 完整快照。导入按 SHA-256 验证配置、Tokenizer 和权重，并把已校验文件发布到开发版目录。同卷 APFS 支持写时复制。
3. 点击「加载并使用」。导入完成后，模型可在离线环境运行，每条输入上限 1024 tokens，输出 2560 维。卸载只释放推理内存。后续本地检索可按需重新加载。
4. 导入 EPUB，从该书的菜单启动向量化。用「检索书籍」对比关键词、向量与混合结果。已向量化的书籍可以在阅读助手中使用章节上下文和引用。
5. 在「设置 → AI」启用联网研究，选择 Auto 或 Always。书籍和网页走同一个 Core 研究 Agent，工具预算和引用来源由 Core 管理。

`vectors.db` 仍为一张固定维度的 sqlite-vec 表。空表可以重配到 2560 维。非空表保留原维度，维度不同的书通过其已持久化的 chunks 向量和既有 Core 余弦路径查询。书籍索引来源须与检索模型匹配。切换模型时按书显式向量化即可更新该书的索引。Mac 开发版固定使用自己的资料库路径。

## 关键代码

| 路径 | 职责 |
| --- | --- |
| `packages/app-expo/modules/readany-mlx-embedding/runtime` | Swift 推理库、共享快照校验及 macOS Sidecar |
| `scripts/build-macos-mlx.sh` | 以 Xcode 构建 Sidecar 与 Metal 资源 |
| `packages/app/src-tauri/src/mlx.rs` | 管理 Sidecar 进程和串行 IPC |
| `packages/app/src-tauri/tauri.macos.conf.json` | 应用标识、资源打包和独立开发入口 |
| `packages/app/src-tauri/src/vector/mod.rs` | 非空索引保护、事务重配和按书余弦相似度 |
| `packages/app/src/lib/rag/desktop-embedding.ts` | 本地引擎分发和批量回调 |
| `packages/app/src/components/settings/MlxModelSettings.tsx` | 模型导入、状态、加载和卸载 |
| `packages/app/src/hooks/use-desktop-research-options.ts` | 现有研究设置与桌面 Parallel HTTP 传输 |

## 本机验收

环境为 MacBook Air M5（16 GB）、macOS 27.3、Xcode 27.2。完整应用与 Sidecar 均为 arm64，应用包通过 `codesign --verify --deep --strict`。

| 项目 | 结果 |
| --- | --- |
| 开发包启动与数据隔离 | 原生窗口启动，数据库写入独立目录。原版应用、默认资料库和 WebKit 原路径均未生成 |
| Qwen3 Q8 | 复用本机快照，经 SHA-256 导入、加载、卸载、按需重载。9 条 fixture 均为 2560 维，与既有 MacProbe 的最低余弦相似度超过 0.999999，最大 L2 归一化误差 7.15e-8 |
| 离线索引与三种检索 | 在屏蔽验收路径的 HTTP 和模型 API 请求时用合成 EPUB 写入 3 条 2560 维索引。BM25、向量及混合首名均为「暂存与心算」，向量余弦约 0.771 |
| CFI 跳转与重启 | 重启后模型文件、三条向量和原索引来源均保留。通过桌面打开引用的入口跳到目标章节，在渲染 EPUB 中解析出 CFI 对应的原文标题，并在普通开发包中点击混合检索结果观察定位 |
| 联网研究 | 同一轮用共享 Agent 执行真实 Parallel 搜索、Qwen3 书内检索及书籍和网页引用登记。Parallel 网页读取曾遇 429，重试后返回 Apple Metal 页面的正文摘录 |
| ONNX 回归 | 普通开发包的内置 ONNX all-MiniLM-L6-v2 下载并加载成功。随后恢复 Qwen3 选择，原 2560 维书籍索引仍在 |
| 普通 AI | 本机 OpenAI 兼容 SSE 端点通过常规聊天流式链路。统一研究验收的生成模型也使用可预测的本机测试端点 |
| 自动检查 | Core 674 项含真实 Parallel、Rust 16 项、Expo 20 项通过。桌面及 Expo 类型检查通过 |

macOS 侧实机验收范围为 M5 和短篇 EPUB。未复测商业 AI 账户、真实远程 Embedding 服务、大型书库压力或其他 Mac 硬件。应用包为本机开发签名，未公证。对同一本书的检索采用现有 sqlite-vec 的余弦计算，索引规模较大时需另做性能基准。

## 桌面 Codex

Codex App Server 聊天的构建、单书授权和验收见 [桌面 Codex 聊天](codex-chat.md)。

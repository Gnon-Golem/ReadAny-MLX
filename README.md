# ReadAny-MLX

[ReadAny](https://github.com/codedogQBY/ReadAny) 的非官方 iOS 修改版，使用 Apple Silicon GPU 在设备上运行 MLX 向量模型。基于官方尚未以 Release 发布的 1.3.7 源码，基线为 [fce44689e1377df1ae99a35e8e71d5e8b3a639d1](https://github.com/codedogQBY/ReadAny/commit/fce44689e1377df1ae99a35e8e71d5e8b3a639d1)。[上游项目说明](README.upstream.md) · [上游中文说明](README_CN.md)

## 功能

- 使用 MLX Swift、MLXEmbedders 和 Metal GPU 运行 Qwen3-Embedding-4B MLX Q8。单条输入最多 1,024 token（含末尾特殊 token），取最后一个 token 的表示，输出经 L2 归一化的 2,560 维向量。
- 书籍向量化和语义查询使用同一个本地模型，只有查询附加 Qwen3 检索指令。权重导入后，索引和向量检索可离线运行。完整聊天回答仍取决于配置的聊天模型。
- 向量模型设置页支持导入、加载、卸载和删除模型。进入后台或收到内存警告时会释放模型，前台查询会按需重新加载。原有 ONNX 与远程 Embedding 入口保留。切换模型后，为需要查询的书建立对应模型的索引。

## 构建与安装

在 Apple Silicon Mac 上安装 Xcode 和 Metal Toolchain，以及 Node.js 22、pnpm 9.15.0、CocoaPods 和 CMake。Swift 依赖要求 Swift 工具链 6.2 或更新版本，构建目标最低为 iOS 17。原始验收使用 Xcode 27.2。

从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
export APP_VARIANT=mlx
# 使用其他标识时，在 prebuild 和 pod install 期间保持相同值。
# export READANY_MLX_BUNDLE_ID=com.example.readany.mlx
cd packages/app-expo
pnpm run build:reader
pnpm exec expo prebuild --platform ios --no-install
(cd ios && pod install)
open ios/ReadAnyMLX.xcworkspace
```

在 Xcode 中选择 `ReadAnyMLX` scheme、自己的 Development Team 和已配对、已启用开发者模式的 iPad。使用 Release 配置构建并运行。默认 Bundle ID 为 `com.readany.mlx.dev`。如遇标识已占用，可在生成工程前用上述变量指定自己的独立标识。复用已有的独立 MLX 安装时，使用相同 Team 和该安装的 Bundle ID。Xcode 的 DerivedData 应使用无空格路径，兼容静态阅读服务的 CMake 构建。

签名后的应用与描述文件都应包含 `com.apple.developer.kernel.increased-memory-limit`。原始验收使用 Xcode Personal Team。SideStore 的免费账号重签可能丢掉这项授权，导入或续签后需检查新签名与进程内存额度。 [Apple 权限说明](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit) · [SideStore 已知问题](https://github.com/SideStore/SideStore/issues/1616)

## 下载和使用模型

下载 [固定的 Hugging Face 快照](https://huggingface.co/majentik/Qwen3-Embedding-4B-MLX-8bit/tree/bf6643fd2d34f6832a1203c870564b1633183885)。将 `config.json`、`tokenizer.json`、`tokenizer_config.json` 和 `model.safetensors` 放在同一文件夹。权重约 4.27 GB，应用会校验该快照的文件哈希。导入期间需为本地副本预留空间。

1. 将文件夹传到 iPad 的「文件」App。
2. 在 ReadAny MLX 中进入「我的 → 向量模型 → 导入模型文件夹」。浏览进入模型文件夹，再点右上角「打开」。
3. 点「加载并使用」，为书籍建立向量索引。

## 实测与兼容性

- MacBook Air M5 上，Swift 与 Python MLX 的 9 组 token ID 一致，最低向量余弦相似度为 0.99999432。
- iPad Pro M5（12 GB，iPadOS 27.3）上的独立探针通过 256、512、1,024 token 推理和连续 100 条测试。ReadAny MLX 用新 EPUB 验证了断网索引、语义与混合检索、引用跳转、后台恢复以及旧 BGE ONNX 索引兼容性。该轮完整应用进程峰值约 4.44 GiB。
- MLX 后端只在有 Metal 的实体 iPad 上启用。其他设备、系统版本、大书压力、联网聊天和同步尚无专项真机数据。可用进程内存不足时会中止模型加载或推理。以上数据来自原始设备验收。

[Mac 与 iPad 验证工程](tools/qwen3-mlx-validation/README.md)

## 许可证

本 Fork 保留 [ReadAny 的 GPL-3.0 许可证文本](LICENSE)、上游版权声明与 Git 历史。ReadAny 项目元数据声明 GPL-3.0-or-later。

| 新增依赖 | 固定版本 | 许可证 |
| --- | --- | --- |
| [MLX Swift](https://github.com/ml-explore/mlx-swift/blob/0.33.0/LICENSE) | 0.33.0 | MIT |
| [MLX Swift LM / MLXEmbedders](https://github.com/ml-explore/mlx-swift-lm/blob/3.33.0/LICENSE) | 3.33.0 | MIT |
| [swift-transformers](https://github.com/huggingface/swift-transformers/blob/1.4.0/LICENSE) | 1.4.0 | Apache-2.0 |
| [Qwen3-Embedding-4B MLX Q8](https://huggingface.co/majentik/Qwen3-Embedding-4B-MLX-8bit) | `bf6643f` | Apache-2.0 |

依赖通过 Swift Package Manager 获取，模型权重由用户从模型发布者下载。本 Fork 发布源码和验证工程。

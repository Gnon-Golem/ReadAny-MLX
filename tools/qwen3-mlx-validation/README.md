# Qwen3 Q8 兼容性验证

验证 `majentik/Qwen3-Embedding-4B-MLX-8bit` 的原始本地快照。Mac 探针使用 Xcode 构建 Metal 着色器，运行时只读取指定的模型目录。Swift 端使用 MLX Swift 0.33.0、MLXEmbedders 3.33.0 与 swift-transformers 1.4.0。

在此目录运行以下命令。Xcode 需安装 Metal Toolchain 组件。Python 参考环境为 MLX 0.32.4、mlx-embeddings 0.1.0、transformers 5.23.0。两端读取同一份测试文本，逐条编码并在截断至 1,024 个 token 时保留末尾的 `<|endoftext|>`。

```sh
model="$HOME/mlx-embedding-test/models/Qwen3-Embedding-4B-MLX-8bit"
python_mlx="$HOME/mlx-embedding-test/.venv/bin/python"
output="$(mktemp -d)"
xcodebuild -scheme Qwen3MLXValidation -configuration Release -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$output/build" -onlyUsePackageVersionsFromResolvedFile build
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  "$python_mlx" compare.py reference "$model" fixtures.json "$output/python.json"
"$output/build/Build/Products/Release/MacProbe" "$model" fixtures.json "$output/swift.json"
"$python_mlx" compare.py compare "$output/python.json" "$output/swift.json"
```

检查逐条 token ID 一致、2560 维、Swift L2 范数距 1 小于 1e-5、跨实现余弦相似度至少 0.999，以及工作记忆查询在两条候选文本上的排序。Swift 将最后一个隐藏状态转换为 float32 后归一化。单条无填充输入使最后一个位置始终为真实 token。

## iPad 实验

打开 `iPadProbe/iPadProbe.xcodeproj`，在 Qwen3Probe target 中选择开发团队，选中已配对的 iPad 并运行 Release。探针有独立 Bundle ID 和 Increased Memory Limit entitlement。检查应用签名和随包描述文件都包含该 entitlement。

在应用中选择「从文件导入模型文件夹」，选中包含原始 Q8 权重和 tokenizer 的本地文件夹，完成后点「运行真机验证」。也可将同一模型文件夹复制到探针容器的 `Documents/IncomingModel`，用 `devicectl device process launch` 传入 `--import-and-benchmark`，走同一导入和推理代码。单独传入 `--benchmark` 使用已导入的模型。

每条请求在 Metal 上逐条运行。探针记录 256、512、1024 token 推理，以及 100 条连续的 256-token 结果。报告位于探针容器的 `Documents/benchmark.json`，记录系统进程 footprint、剩余内存额度、MLX active/cache/peak、设备信息和耗时。

## ReadAny MLX 开发版

开发变体使用 `APP_VARIANT=mlx` 和独立 Bundle ID `com.readany.mlx.dev`。在当前工作树安装锁定的 pnpm 依赖后，从 `packages/app-expo` 执行：

```sh
pnpm run build:reader
APP_VARIANT=mlx pnpm exec expo prebuild --platform ios --no-install
(cd ios && APP_VARIANT=mlx pod install)
```

通过 `ios/ReadAnyMLX.xcworkspace` 使用 `ReadAnyMLX` scheme 构建 Release，设置自己的开发团队。用于设备验收的签名和描述文件都需包含 Increased Memory Limit。Release 包内含 JavaScript 和 Metal 着色器。命令行指定 DerivedData 时使用无空格的路径，兼容静态阅读服务依赖的 CMake 构建。

在设置的「向量模型」里点「导入模型文件夹」。进入完整 Q8 模型所在目录后点文件选择器右上角的「打开」，然后点「加载并使用」。导入流式校验权重和 tokenizer 的 SHA-256，以便已建立的 2560 维索引持续对应相同模型。模型卸载后仍保留本地文件和索引。切到后台或收到系统内存警告时会释放模型，返回前台后的查询会重新加载。纯本地向量化和检索独立于聊天模型的网络设置。

共享运行时位于 `packages/app-expo/modules/readany-mlx-embedding/runtime`。现有 ONNX 和远程模式沿用同一个设置入口，选择不同模型后需使用该模型对应的索引。

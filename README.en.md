# ReadAny-MLX

[中文 / 中文首页](README.md) · [Download the research iOS IPA](https://raw.githubusercontent.com/Gnon-Golem/ReadAny-MLX/f577d780ef6a53c4a6fc5b6d781abd7350010481/ReadAny-MLX-1.3.7-build2-research-iOS.ipa) · [SHA-256](https://raw.githubusercontent.com/Gnon-Golem/ReadAny-MLX/f577d780ef6a53c4a6fc5b6d781abd7350010481/SHA256SUMS-research.txt)

An unofficial iOS fork of [ReadAny](https://github.com/codedogQBY/ReadAny) with on-device MLX embeddings and semantic retrieval on Apple Silicon iPad. This fork is based on ReadAny 1.3.7 source at upstream commit [`fce4468`](https://github.com/codedogQBY/ReadAny/commit/fce44689e1377df1ae99a35e8e71d5e8b3a639d1), which had no official 1.3.7 release at the time of this build.

## Web research

Open **AI Settings → Web research** to choose Off, Auto, or Always. Off is the default. In Auto, the book assistant uses the question and conversation to decide when to search and uses separate queries for the book and the web. Hybrid answers can link to the cited EPUB passage and the original web page. You can also attach a web source to a book note. Expand **Search book content** to see the vector search status.

Web search uses Parallel and can be rate-limited. Indexed books remain searchable on-device when offline or when web search fails. The search provider receives query terms. The configured chat model generates the answer.

An Xcode-signed iPad build exercised book retrieval and live web search in the same turn. The latest query changes passed automated tests and a comparison with the same Q8 model. The fixed build installed and launched on iPad. Conversation quality with the user's chat provider and SideStore installation and refresh of the public IPA are pending device verification.

[Research branch](https://github.com/Gnon-Golem/ReadAny-MLX/tree/feat/unified-research) · [Corresponding source for this IPA](https://github.com/Gnon-Golem/ReadAny-MLX/tree/6df597d6de8bc83e24395e84eeb38a68fac55982) · [Architecture, validation and limitations](https://github.com/Gnon-Golem/ReadAny-MLX/tree/6df597d6de8bc83e24395e84eeb38a68fac55982/docs/superpowers/specs/2026-11-21-unified-research-design.md)

## Features

- MLX Swift, MLXEmbedders and Metal run Qwen3-Embedding-4B Q8 locally. The engine takes up to 1,024 tokens per input, including the final special token, and produces 2,560-dimensional L2-normalized vectors with last-token pooling.
- Book passages and queries use the same model. Only queries receive the Qwen3 retrieval instruction. Indexing and vector retrieval work offline after model import. Full chat answers depend on the configured chat model.
- The embedding settings support model import, load, unload and deletion. The app releases the model in the background or on a memory warning and reloads it on demand. Existing ONNX and remote embedding options remain available. Create an index for the selected model after switching.

## Install the IPA

1. [Download the research iOS IPA](https://raw.githubusercontent.com/Gnon-Golem/ReadAny-MLX/f577d780ef6a53c4a6fc5b6d781abd7350010481/ReadAny-MLX-1.3.7-build2-research-iOS.ipa) (1.3.7, build 2, 35.7 MiB). The [earlier local MLX build](https://raw.githubusercontent.com/Gnon-Golem/ReadAny-MLX/4f775c8da29196bd247bb46c1ab112355952ba87/ReadAny-MLX-1.3.7-build2-iOS.ipa) is also available.
2. On your iPad, import the file into SideStore and sign it using your Apple ID. The package uses the separate bundle ID `com.readany.mlx.dev` before signing. Sideloading tools can change the ID.
3. [Download the model weights](#download-and-import-the-model) and import them from Files.

The public IPA uses an ad hoc signature. The embedded Increased Memory Limit request needs a provisioning profile that grants it and a resulting app signature that carries it. Free-team SideStore signing or refreshing can omit it. The device results below come from an Xcode-signed build. SideStore installation and refresh of the public IPA have yet to be verified on a device. [Apple entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit) · [SideStore issue](https://github.com/SideStore/SideStore/issues/1616)

## Download and import the model

Get the [pinned Hugging Face snapshot](https://huggingface.co/majentik/Qwen3-Embedding-4B-MLX-8bit/tree/bf6643fd2d34f6832a1203c870564b1633183885). Put `config.json`, `tokenizer.json`, `tokenizer_config.json` and `model.safetensors` in one folder in Files. The weights are about 4.27 GB. Allow storage for a local copy during import. The app checks file hashes against this snapshot.

Open the embedding model settings from your profile in ReadAny MLX. On the Qwen3 card, tap **导入模型文件夹** (Import Model Folder). Navigate *into* the folder and tap **Open** in the upper-right corner. Tap **加载并使用** (Load and Use), then build an embedding index for your book. The Qwen3 card currently displays these controls in Chinese.

## Build from source

Use an Apple Silicon Mac with Xcode, the Metal Toolchain, Swift 6.2 or later, Node.js 22, pnpm 9.15.0, CocoaPods and CMake. The original build used Xcode 27.2. To build the research edition, check out [`feat/unified-research`](https://github.com/Gnon-Golem/ReadAny-MLX/tree/feat/unified-research). Run from the repository root.

```sh
pnpm install --frozen-lockfile
export APP_VARIANT=mlx
# For a custom ID, use the same value for prebuild and pod install.
# export READANY_MLX_BUNDLE_ID=com.example.readany.mlx
cd packages/app-expo
pnpm run build:reader
pnpm exec expo prebuild --platform ios --no-install
(cd ios && pod install)
open ios/ReadAnyMLX.xcworkspace
```

In Xcode, select the `ReadAnyMLX` scheme, your development team and a paired iPad with Developer Mode enabled. Build and run with the Release configuration. If the default bundle ID is unavailable, set your own before generating the project. Use the same bundle ID and team when updating an existing independent installation. Use a DerivedData path without spaces for the reader's CMake build.

## Tested compatibility

- On MacBook Air M5, Swift and Python MLX produced identical token IDs across nine cases. The lowest vector cosine similarity was 0.99999432.
- On iPad Pro M5 with 12 GB RAM and iPadOS 27.3, the standalone probe passed 256-, 512- and 1,024-token inference and a 100-item run. The Xcode-signed app was verified with a new EPUB for offline indexing, semantic and hybrid retrieval, source jumps, foreground recovery and existing BGE ONNX index compatibility. Peak process use for that full-app test was approximately 4.44 GiB.
- The iOS build targets iOS 17 or later. The MLX backend is enabled on physical iPads with Metal. Other devices and OS versions, large-book workloads, and cross-device WebDAV sync with real accounts are pending device validation. The engine can stop model loading or inference when available process memory is insufficient. [Validation projects](tools/qwen3-mlx-validation/README.md)

## License and source

ReadAny-MLX preserves the upstream [GPL-3.0 license text](LICENSE), copyright notices and Git history. Upstream identifies the project as GPL-3.0-or-later. The [research IPA source](https://github.com/Gnon-Golem/ReadAny-MLX/tree/6df597d6de8bc83e24395e84eeb38a68fac55982), [earlier local MLX IPA source](https://github.com/Gnon-Golem/ReadAny-MLX/tree/328971a1d9f840e22f0dbce38d61aaf7f764b56e), and [dependency license table](README.md#许可证) are available here. The Qwen3 snapshot is Apache-2.0 and is distributed separately by its publisher.

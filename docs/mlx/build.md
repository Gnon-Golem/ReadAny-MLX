# 安装与构建

[文档索引](README.md) · [English](#english)

## 校验并侧载 iPad IPA

从[首页下载表](../../README.md#下载)下载对应 IPA 与 SHA-256 文件，放在同一目录。运行匹配的命令，看到 `OK` 后再导入 SideStore，用自己的账号重新签名。

```sh
# 联网研究版 / Web research
shasum -a 256 -c SHA256SUMS-research.txt
# 本地 MLX 版 / Local MLX
shasum -a 256 -c SHA256SUMS.txt
```

公开包的匿名下载与哈希已验证。SideStore 首次安装、续签及 Increased Memory Limit 在新签名中的保留仍待实机验证。安装后的模型权重需[单独导入](configuration.md#向量模型)。

## 从源码构建 iPad 版

使用 Apple Silicon Mac、Xcode、Metal Toolchain、Node.js 22、pnpm 9.15.0、CocoaPods 和 CMake。Swift 依赖要求 Swift 6.2 或更新版本，已验证工具链为 Xcode 27.2。iOS 17 是构建目标下限，设备可用性以[实机测试](verification.md)为准。

```sh
git clone --branch mlx-ios https://github.com/Gnon-Golem/ReadAny-MLX.git
cd ReadAny-MLX
pnpm install --frozen-lockfile
export APP_VARIANT=mlx
cd packages/app-expo
pnpm run build:reader
pnpm exec expo prebuild --platform ios --no-install
(cd ios && pod install)
open ios/ReadAnyMLX.xcworkspace
```

在 Xcode 选择 `ReadAnyMLX` scheme、自有 Development Team 和已配对且开启开发者模式的 iPad，使用 Release 配置。自定义 Bundle ID、签名内存权限和 DerivedData 路径见 [iPad 分支指南](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/README.md#构建与安装)。

## 从源码构建 macOS 版

需要 Apple Silicon、Xcode、Metal Toolchain、Node.js 22、pnpm 9.15.0 和 Rust stable。按需要选择基础版或 Agent 版分支。

```sh
git clone --branch macos-mlx https://github.com/Gnon-Golem/ReadAny-MLX.git
# Agent 版将上面的 macos-mlx 替换为 feat/macos-mlx-agents
# For the Agent edition, replace macos-mlx above with feat/macos-mlx-agents.
cd ReadAny-MLX
pnpm install --frozen-lockfile
APPLE_SIGNING_IDENTITY=- pnpm tauri build --bundles app
open "packages/app/src-tauri/target/release/bundle/macos/ReadAny MLX Dev.app"
```

命令生成本机 ad-hoc 签名的 arm64 开发包，源码构建包含 Swift sidecar 与 Metal 库。两套 Mac 开发分支共用开发版 Bundle ID 和数据目录，正式上游版使用独立标识。详细环境、开发命令及数据路径见[基础版指南](https://github.com/Gnon-Golem/ReadAny-MLX/blob/macos-mlx/docs/macos-mlx.md)和 [Agent 分支构建指南](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/macos-mlx.md)。

## English

[Documentation index](README.md#english)

### Verify and sideload an iPad IPA

Download the IPA and its SHA-256 file from the [download table](../../README.en.md#downloads) into the same directory. Run the corresponding `shasum` command [above](#校验并侧载-ipad-ipa). Once it reports `OK`, import the IPA into SideStore and sign with your own account.

Anonymous downloads and file hashes have been verified. First-time SideStore installation, refresh, and retention of Increased Memory Limit after signing still need device verification. [Import the model weights separately](configuration.md#embedding-model).

### Build the iPad edition

On an Apple Silicon Mac, install Xcode, the Metal Toolchain, Node.js 22, pnpm 9.15.0, CocoaPods, and CMake. The Swift dependencies require Swift 6.2 or later. The recorded build used Xcode 27.2. iOS 17 is the deployment target floor. See [device verification](verification.md#english) for tested hardware and software.

Run the [iPad commands above](#从源码构建-ipad-版). In Xcode, choose the `ReadAnyMLX` scheme, your Development Team, and a paired iPad with Developer Mode enabled. Build with the Release configuration. The [iPad branch guide](https://github.com/Gnon-Golem/ReadAny-MLX/blob/mlx-ios/README.en.md) covers custom bundle IDs, memory entitlements, and DerivedData.

### Build the macOS editions

Use Apple Silicon, Xcode, the Metal Toolchain, Node.js 22, pnpm 9.15.0, and Rust stable. Follow the [macOS commands above](#从源码构建-macos-版) with either `macos-mlx` or `feat/macos-mlx-agents`. The Tauri build packages a Swift sidecar and Metal library in an ad hoc-signed arm64 development app. Both macOS development branches use the same development bundle ID and data directory. The upstream app has its own ID. See the [base build guide](https://github.com/Gnon-Golem/ReadAny-MLX/blob/macos-mlx/docs/macos-mlx.md) or the [Agent branch build guide](https://github.com/Gnon-Golem/ReadAny-MLX/blob/feat/macos-mlx-agents/docs/macos-mlx.md) for developer commands and paths.

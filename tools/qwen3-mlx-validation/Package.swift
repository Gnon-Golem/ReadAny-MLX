// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Qwen3MLXValidation",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "MacProbe", targets: ["MacProbe"])],
    dependencies: [
        .package(path: "../../packages/app-expo/modules/readany-mlx-embedding/runtime"),
    ],
    targets: [
        .executableTarget(
            name: "MacProbe",
            dependencies: [.product(name: "Qwen3Embedding", package: "runtime")]
        ),
    ]
)

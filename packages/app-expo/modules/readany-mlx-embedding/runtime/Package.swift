// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "ReadAnyMLXRuntime",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "Qwen3Embedding", targets: ["Qwen3Embedding"])],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift", exact: "0.33.0"),
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", exact: "3.33.0", traits: []),
        .package(url: "https://github.com/huggingface/swift-transformers", exact: "1.4.0"),
    ],
    targets: [
        .target(
            name: "Qwen3Embedding",
            dependencies: [
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "MLXEmbedders", package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                .product(name: "Tokenizers", package: "swift-transformers"),
            ]
        ),
    ]
)

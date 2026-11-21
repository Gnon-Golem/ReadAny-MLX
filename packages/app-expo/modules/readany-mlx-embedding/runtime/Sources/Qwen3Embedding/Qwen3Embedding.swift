import Foundation
import MLX
import MLXEmbedders

public struct EmbeddingResult: Codable, Sendable {
    public let tokens: [Int]
    public let vector: [Float]
    public let seconds: Double
}

public enum EmbeddingError: LocalizedError {
    case invalidPooling
    case invalidTokenLimit
    case missingEndToken
    case invalidOutput

    public var errorDescription: String? {
        switch self {
        case .invalidPooling: "The Qwen3 model requires last-token pooling."
        case .invalidTokenLimit: "The token limit must be between 1 and 1,024."
        case .missingEndToken: "The Qwen3 tokenizer is missing the expected end-of-text token."
        case .invalidOutput: "Expected a finite 2,560-dimensional embedding."
        }
    }
}

public struct Qwen3Embedding: Sendable {
    private let container: EmbedderModelContainer

    public static func load(from directory: URL) async throws -> Self {
        Memory.cacheLimit = 64 * 1024 * 1024
        let container = try await Device.withDefaultDevice(.gpu) {
            try await EmbedderModelFactory.shared.loadContainer(
                from: directory, using: LocalTokenizerLoader())
        }
        guard case .last = await container.poolingStrategy else {
            throw EmbeddingError.invalidPooling
        }
        return Self(container: container)
    }

    public func embed(_ text: String, maxTokens: Int) async throws -> EmbeddingResult {
        guard (1...1024).contains(maxTokens) else { throw EmbeddingError.invalidTokenLimit }
        return try await container.perform { context in
            let start = Date()
            guard let endToken = context.tokenizer.convertTokenToId("<|endoftext|>"),
                endToken == 151643
            else {
                throw EmbeddingError.missingEndToken
            }
            // The checkpoint post-processor appends this token after truncation.
            var tokens = Array(context.tokenizer.encode(text: text, addSpecialTokens: false)
                .prefix(maxTokens - 1))
            tokens.append(endToken)
            let vector = try Device.withDefaultDevice(.gpu) {
                // One unpadded row lets us select the last real token directly.
                let inputIDs = MLXArray(tokens.map(Int32.init)).reshaped(1, tokens.count)
                let output = context.model(
                    inputIDs, positionIds: nil, tokenTypeIds: nil, attentionMask: nil)
                guard let lastToken = output.hiddenStates?[0, -1, 0...] else {
                    throw EmbeddingError.invalidOutput
                }
                let floats = lastToken.asType(.float32)
                let normalized = floats / sqrt(sum(floats * floats))
                try MLX.checkedEval(normalized)
                return normalized.asArray(Float.self)
            }
            guard vector.count == 2560, vector.allSatisfy({ $0.isFinite }) else {
                throw EmbeddingError.invalidOutput
            }
            return EmbeddingResult(tokens: tokens, vector: vector, seconds: Date().timeIntervalSince(start))
        }
    }

    public static var mlxMemory: [String: Int] {
        ["active": Memory.activeMemory, "cache": Memory.cacheMemory, "peak": Memory.peakMemory]
    }
}

extension Qwen3Embedding {
    public static func releaseCache() {
        Memory.clearCache()
    }
}

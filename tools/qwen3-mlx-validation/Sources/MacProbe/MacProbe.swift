import Foundation
import Qwen3Embedding

private struct ProbeReport: Encodable {
    let vectors: [EmbeddingResult]
    let loadSeconds: Double
    let mlxMemory: [String: Int]
}

@main
struct MacProbe {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count == 4 else {
            FileHandle.standardError.write(Data("Usage: MacProbe MODEL FIXTURES_JSON OUTPUT_JSON\n".utf8))
            exit(64)
        }
        let texts = try JSONDecoder().decode(
            [String].self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
        let start = Date()
        let model = try await Qwen3Embedding.load(
            from: URL(fileURLWithPath: args[1], isDirectory: true))
        let loadSeconds = Date().timeIntervalSince(start)
        var vectors: [EmbeddingResult] = []
        for text in texts {
            vectors.append(try await model.embed(text, maxTokens: 1024))
        }
        let report = ProbeReport(
            vectors: vectors, loadSeconds: loadSeconds, mlxMemory: Qwen3Embedding.mlxMemory)
        try JSONEncoder().encode(report).write(to: URL(fileURLWithPath: args[3]), options: .atomic)
    }
}

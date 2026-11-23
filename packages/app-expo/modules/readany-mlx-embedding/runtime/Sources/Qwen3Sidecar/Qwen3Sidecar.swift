import Darwin
import Foundation
import Metal
import Qwen3Embedding

private struct Request: Decodable {
    enum Operation: String, Decodable {
        case status, importModel, load, unload, embed
    }

    let operation: Operation
    let source: String?
    let texts: [String]?
}

private struct Status: Encodable {
    let available: Bool
    let imported: Bool
    let loaded: Bool
}

private struct Response: Encodable {
    var status: Status? = nil
    var vectors: [[Float]]? = nil
    var error: String? = nil
}

private enum SidecarError: LocalizedError {
    case noGPU, modelMissing, invalidRequest

    var errorDescription: String? {
        switch self {
        case .noGPU: "A Metal GPU is required for Qwen3 MLX."
        case .modelMissing: "Import the verified Qwen3 Q8 model folder first."
        case .invalidRequest: "The Qwen3 MLX request is invalid."
        }
    }
}

private struct Runtime {
    let files: Qwen3ModelFiles
    let available = MTLCreateSystemDefaultDevice() != nil
    var model: Qwen3Embedding?

    private var status: Status {
        Status(available: available, imported: files.isImported, loaded: model != nil)
    }

    private mutating func load() async throws -> Qwen3Embedding {
        if let model { return model }
        guard files.isImported else { throw SidecarError.modelMissing }
        let loaded = try await Qwen3Embedding.load(from: files.directory)
        model = loaded
        return loaded
    }

    mutating func execute(_ request: Request) async throws -> Response {
        if request.operation == .status { return Response(status: status) }
        guard available else { throw SidecarError.noGPU }

        switch request.operation {
        case .status:
            return Response(status: status)
        case .importModel:
            guard let source = request.source, source.hasPrefix("/") else {
                throw SidecarError.invalidRequest
            }
            try files.importFolder(URL(fileURLWithPath: source, isDirectory: true))
        case .load:
            _ = try await load()
        case .unload:
            model = nil
            Qwen3Embedding.releaseCache()
        case .embed:
            guard let texts = request.texts, (1...16).contains(texts.count) else {
                throw SidecarError.invalidRequest
            }
            let loaded = try await load()
            var vectors: [[Float]] = []
            vectors.reserveCapacity(texts.count)
            for text in texts {
                vectors.append(try await loaded.embed(text, maxTokens: 1024).vector)
            }
            return Response(status: status, vectors: vectors)
        }
        return Response(status: status)
    }
}

@main
struct Qwen3Sidecar {
    static func main() async throws {
        guard CommandLine.arguments.count == 2 else { throw SidecarError.invalidRequest }
        // Keep native library diagnostics separate from the JSON Lines protocol.
        let protocolFD = dup(STDOUT_FILENO)
        guard protocolFD >= 0, dup2(STDERR_FILENO, STDOUT_FILENO) >= 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
        let output = FileHandle(fileDescriptor: protocolFD, closeOnDealloc: true)
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        var runtime = Runtime(files: Qwen3ModelFiles(directory: root))
        let decoder = JSONDecoder()
        let encoder = JSONEncoder()
        while let line = readLine() {
            let response: Response
            do {
                let request = try decoder.decode(Request.self, from: Data(line.utf8))
                response = try await runtime.execute(request)
            } catch {
                response = Response(error: error.localizedDescription)
            }
            try output.write(contentsOf: encoder.encode(response) + Data([0x0A]))
        }
        // EOF arrives when the desktop process closes its pipes.
    }
}

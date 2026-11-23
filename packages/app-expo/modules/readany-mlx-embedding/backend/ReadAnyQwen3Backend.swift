import Foundation
import Metal
import os
import UIKit
import Qwen3Embedding
import ReadAnyMLXEmbedding

@objc(ReadAnyQwen3Backend)
final class ReadAnyQwen3Backend: NSObject, ReadAnyMLXEmbeddingBackend {
    private static let modelFiles = Qwen3ModelFiles(
        directory: URL.applicationSupportDirectory
            .appendingPathComponent("ReadAnyModels/Qwen3Embedding4BMLXQ8", isDirectory: true))
    private var model: Qwen3Embedding?
    private var busy = false
    private var unloadAfterOperation = false
    private var observers: [NSObjectProtocol] = []

    private static let supported: Bool = {
        #if targetEnvironment(simulator)
        return false
        #else
        return UIDevice.current.userInterfaceIdiom == .pad && MTLCreateSystemDefaultDevice() != nil
        #endif
    }()

    required override init() {
        super.init()
        for name in [UIApplication.didEnterBackgroundNotification, UIApplication.didReceiveMemoryWarningNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                if self.busy {
                    self.unloadAfterOperation = true
                } else {
                    self.release()
                }
            })
        }
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    func status() -> [String: Bool] {
        ["available": Self.supported, "imported": Self.modelFiles.isImported, "loaded": model != nil]
    }

    func importFolder(_ url: URL, completion: @escaping (NSError?) -> Void) {
        perform({ try await Task.detached(priority: .utility) { try Self.modelFiles.importFolder(url) }.value },
                completion: completion)
    }

    func load(completion: @escaping (NSError?) -> Void) {
        perform({ try await self.ensureLoaded() }, completion: completion)
    }

    func embed(_ text: String, completion: @escaping ([NSNumber]?, NSError?) -> Void) {
        run({
            try await self.ensureLoaded()
            try self.requireForeground()
            guard os_proc_available_memory() >= 768 * 1024 * 1024, let model = self.model else {
                throw MLXModelError.insufficientMemory
            }
            return try await model.embed(text, maxTokens: 1024).vector.map { NSNumber(value: $0) }
        }, completion: completion)
    }

    func unload(completion: @escaping (NSError?) -> Void) {
        perform({ self.release() }, completion: completion)
    }

    func deleteModel(completion: @escaping (NSError?) -> Void) {
        perform({
            self.release()
            try Self.modelFiles.remove()
        }, completion: completion)
    }

    private func perform(_ operation: @escaping @MainActor () async throws -> Void, completion: @escaping (NSError?) -> Void) {
        run(operation) { _, error in completion(error) }
    }

    // Calls arrive on the module's main queue. Keep lifecycle operations exclusive
    // while the package awaits GPU work or file I/O.
    private func run<Value>(_ operation: @escaping @MainActor () async throws -> Value,
                            completion: @escaping (Value?, NSError?) -> Void) {
        guard !busy else {
            completion(nil, MLXModelError.busy as NSError)
            return
        }
        busy = true
        Task { @MainActor in
            let result: Result<Value, Error>
            do { result = .success(try await operation()) }
            catch { result = .failure(error) }
            busy = false
            if unloadAfterOperation {
                unloadAfterOperation = false
                release()
            }
            switch result {
            case .success(let value): completion(value, nil)
            case .failure(let error): completion(nil, error as NSError)
            }
        }
    }

    @MainActor private func ensureLoaded() async throws {
        try requireForeground()
        if model != nil { return }
        guard Self.modelFiles.isImported else { throw MLXModelError.modelMissing }
        guard os_proc_available_memory() >= Qwen3ModelFiles.weightBytes + 768 * 1024 * 1024 else {
            throw MLXModelError.insufficientMemory
        }
        model = try await Qwen3Embedding.load(from: Self.modelFiles.directory)
    }

    @MainActor private func requireForeground() throws {
        guard UIApplication.shared.applicationState != .background else { throw MLXModelError.background }
    }

    private func release() {
        guard model != nil else { return }
        model = nil
        Qwen3Embedding.releaseCache()
    }
}

private enum MLXModelError: LocalizedError {
    case busy, background, modelMissing, insufficientMemory

    var errorDescription: String? {
        switch self {
        case .busy: "A Qwen3 operation is already running."
        case .background: "Return to ReadAny to run Qwen3 on the GPU."
        case .modelMissing: "Import the Qwen3 Q8 model folder before loading it."
        case .insufficientMemory: "The iPad has insufficient memory available to run Qwen3."
        }
    }
}

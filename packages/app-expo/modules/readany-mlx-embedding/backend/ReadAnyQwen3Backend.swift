import CryptoKit
import Foundation
import Metal
import os
import UIKit
import Qwen3Embedding
import ReadAnyMLXEmbedding

@objc(ReadAnyQwen3Backend)
final class ReadAnyQwen3Backend: NSObject, ReadAnyMLXEmbeddingBackend {
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
        ["available": Self.supported, "imported": ModelFiles.isImported, "loaded": model != nil]
    }

    func importFolder(_ url: URL, completion: @escaping (NSError?) -> Void) {
        perform({ try await Task.detached(priority: .utility) { try ModelFiles.importFolder(url) }.value },
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
            try ModelFiles.remove()
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
        guard ModelFiles.isImported else { throw MLXModelError.modelMissing }
        guard os_proc_available_memory() >= ModelFiles.weightBytes + 768 * 1024 * 1024 else {
            throw MLXModelError.insufficientMemory
        }
        model = try await Qwen3Embedding.load(from: ModelFiles.directory)
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
    case busy, background, modelMissing, wrongSnapshot, insufficientMemory

    var errorDescription: String? {
        switch self {
        case .busy: "A Qwen3 operation is already running."
        case .background: "Return to ReadAny to run Qwen3 on the GPU."
        case .modelMissing: "Import the Qwen3 Q8 model folder before loading it."
        case .wrongSnapshot: "The folder does not contain the verified majentik/Qwen3-Embedding-4B-MLX-8bit snapshot."
        case .insufficientMemory: "The iPad has insufficient memory available to run Qwen3."
        }
    }
}

private enum ModelFiles {
    static let weightBytes = 4_273_421_236
    static let directory = URL.applicationSupportDirectory
        .appendingPathComponent("ReadAnyModels/Qwen3Embedding4BMLXQ8", isDirectory: true)
    // The embedding index identifies this exact model and tokenizer. Verify
    // the copied bytes before publishing the folder under that identity.
    private static let fingerprints = [
        "config.json": "3a78fe960dd46951c52df2631fd8f01a91b9aa09dc7a2ae7b619266ea2d344f0",
        "tokenizer.json": "31f82e8f8c173bff1b34626d065393d33938f6d27a7448cfb706bbf9d3c0e651",
        "tokenizer_config.json": "579073f506a3f85caed232bb91617cfb93028408d1f43ffaf66f3fc1aee9a9af",
        "model.safetensors": "40c34c3cb0df6dd2f9e954b32eaf44e4297fad2de9aa38655d2eb0a44fa62654",
    ]

    static var isImported: Bool {
        let size = try? directory.appendingPathComponent("model.safetensors")
            .resourceValues(forKeys: [.fileSizeKey]).fileSize
        return size == weightBytes && fingerprints.keys.allSatisfy {
            FileManager.default.fileExists(atPath: directory.appendingPathComponent($0).path)
        }
    }

    static func remove() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }

    static func importFolder(_ source: URL) throws {
        if isImported { return }
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        let files = FileManager.default
        let parent = directory.deletingLastPathComponent()
        try files.createDirectory(at: parent, withIntermediateDirectories: true)
        var staging = parent.appendingPathComponent("ImportingQwen3", isDirectory: true)
        if files.fileExists(atPath: staging.path) { try files.removeItem(at: staging) }
        try files.createDirectory(at: staging, withIntermediateDirectories: false)
        defer { try? files.removeItem(at: staging) }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try staging.setResourceValues(values)

        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var copyError: Error?
        coordinator.coordinate(readingItemAt: source, options: [], error: &coordinationError) { folder in
            do {
                for (filename, fingerprint) in fingerprints {
                    let from = folder.appendingPathComponent(filename)
                    let attrs = try from.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                    guard attrs.isRegularFile == true, attrs.isSymbolicLink != true,
                        filename != "model.safetensors" || attrs.fileSize == weightBytes
                    else { throw MLXModelError.wrongSnapshot }
                    let destination = staging.appendingPathComponent(filename)
                    try files.copyItem(at: from, to: destination)
                    guard try digest(destination) == fingerprint else { throw MLXModelError.wrongSnapshot }
                }
            } catch {
                copyError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let copyError { throw copyError }
        if files.fileExists(atPath: directory.path) {
            _ = try files.replaceItemAt(directory, withItemAt: staging)
        } else {
            try files.moveItem(at: staging, to: directory)
        }
    }

    private static func digest(_ file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hash = SHA256()
        while let block = try handle.read(upToCount: 4 * 1024 * 1024), !block.isEmpty {
            hash.update(data: block)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

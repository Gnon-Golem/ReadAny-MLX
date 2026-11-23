import CryptoKit
import Foundation
#if os(macOS)
import Darwin
#endif

private enum Qwen3SnapshotError: LocalizedError {
    case invalid

    var errorDescription: String? {
        "The folder does not contain the verified majentik/Qwen3-Embedding-4B-MLX-8bit snapshot."
    }
}

public struct Qwen3ModelFiles: Sendable {
    public static let weightBytes = 4_273_421_236
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    // The embedding index identifies this exact model and tokenizer. Verify
    // the copied bytes before publishing the folder under that identity.
    private static let fingerprints = [
        "config.json": "3a78fe960dd46951c52df2631fd8f01a91b9aa09dc7a2ae7b619266ea2d344f0",
        "tokenizer.json": "31f82e8f8c173bff1b34626d065393d33938f6d27a7448cfb706bbf9d3c0e651",
        "tokenizer_config.json": "579073f506a3f85caed232bb91617cfb93028408d1f43ffaf66f3fc1aee9a9af",
        "model.safetensors": "40c34c3cb0df6dd2f9e954b32eaf44e4297fad2de9aa38655d2eb0a44fa62654",
    ]

    public var isImported: Bool {
        let size = try? directory.appendingPathComponent("model.safetensors")
            .resourceValues(forKeys: [.fileSizeKey]).fileSize
        return size == Self.weightBytes && Self.fingerprints.keys.allSatisfy {
            FileManager.default.fileExists(atPath: directory.appendingPathComponent($0).path)
        }
    }

    public func remove() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }

    public func importFolder(_ source: URL) throws {
        if isImported { return }
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        let files = FileManager.default
        let parent = directory.deletingLastPathComponent()
        try files.createDirectory(at: parent, withIntermediateDirectories: true)
        var staging = parent.appendingPathComponent(".ImportingQwen3-\(UUID().uuidString)", isDirectory: true)
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
                for (filename, fingerprint) in Self.fingerprints {
                    let from = folder.appendingPathComponent(filename)
                    let attrs = try from.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                    guard attrs.isRegularFile == true, attrs.isSymbolicLink != true,
                        filename != "model.safetensors" || attrs.fileSize == Self.weightBytes
                    else { throw Qwen3SnapshotError.invalid }
                    let destination = staging.appendingPathComponent(filename)
                    #if os(macOS)
                    // Keep a private APFS copy where possible, including for the
                    // multi-gigabyte weights already on the same local volume.
                    if clonefile(from.path, destination.path, 0) != 0 {
                        try files.copyItem(at: from, to: destination)
                    }
                    #else
                    try files.copyItem(at: from, to: destination)
                    #endif
                    guard try Self.digest(destination) == fingerprint else { throw Qwen3SnapshotError.invalid }
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

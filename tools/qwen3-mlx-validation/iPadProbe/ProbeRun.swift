import Darwin
import Foundation
import Metal
import os
import Qwen3Embedding

enum ProbeRun {
    static let documents = URL.documentsDirectory
    private static let store = URL.applicationSupportDirectory.appendingPathComponent("Qwen3Q8")
    private static let weightBytes = 4_273_421_236
    private static let mib = 1_048_576
    private static let files = [
        "config.json", "model.safetensors.index.json", "tokenizer.json",
        "tokenizer_config.json", "model.safetensors",
    ]

    private struct Config: Decodable {
        struct Quantization: Decodable {
            let group_size: Int
            let bits: Int
            let mode: String
        }
        let model_type: String
        let hidden_size: Int
        let quantization: Quantization
    }

    private struct Sample: Codable {
        let label: String
        let available: Int
        let footprint: UInt64
        let peakFootprint: Int64
        let mlx: [String: Int]

        init(_ label: String) {
            self.label = label
            available = os_proc_available_memory()
            var info = task_vm_info_data_t()
            var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.stride / 4)
            let result = withUnsafeMutablePointer(to: &info) {
                $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                    task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
                }
            }
            footprint = result == KERN_SUCCESS ? info.phys_footprint : 0
            peakFootprint = result == KERN_SUCCESS ? info.ledger_phys_footprint_peak : 0
            mlx = Qwen3Embedding.mlxMemory
        }
    }

    private struct Report: Codable {
        let gpu: String
        let deviceMemory: UInt64
        var loadSeconds: Double?
        var timings: [Int: Double] = [:]
        var continuousSeconds: [Double] = []
        var samples: [Sample] = []
        var failure: String?
    }

    nonisolated static func importModel(from source: URL) async throws {
        try await Task.detached(priority: .utility) {
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            let fm = FileManager.default
            let parent = store.deletingLastPathComponent()
            try fm.createDirectory(at: parent, withIntermediateDirectories: true)
            let temporary = parent.appendingPathComponent(UUID().uuidString)
            try fm.createDirectory(at: temporary, withIntermediateDirectories: false)
            defer { try? fm.removeItem(at: temporary) }
            let coordinator = NSFileCoordinator()
            var coordinationError: NSError?
            var copyError: Error?
            coordinator.coordinate(readingItemAt: source, options: [], error: &coordinationError) { folder in
                do {
                    try validate(folder)
                    for name in files {
                        let file = folder.appendingPathComponent(name)
                        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                        guard values.isRegularFile == true, values.isSymbolicLink != true else {
                            throw CocoaError(.fileReadUnsupportedScheme)
                        }
                        try fm.copyItem(at: file, to: temporary.appendingPathComponent(name))
                    }
                } catch {
                    copyError = error
                }
            }
            if let coordinationError { throw coordinationError }
            if let copyError { throw copyError }
            try validate(temporary)
            if fm.fileExists(atPath: store.path) {
                _ = try fm.replaceItemAt(store, withItemAt: temporary)
            } else {
                try fm.moveItem(at: temporary, to: store)
            }
        }.value
    }

    static func benchmark(_ log: @MainActor @Sendable (String) -> Void) async throws {
        guard let gpu = MTLCreateSystemDefaultDevice() else {
            throw failure("设备未报告可用 Metal GPU。")
        }
        var report = Report(gpu: gpu.name, deviceMemory: ProcessInfo.processInfo.physicalMemory)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        func writeReport() throws {
            try encoder.encode(report).write(
                to: documents.appendingPathComponent("benchmark.json"), options: .atomic)
        }
        func checkpoint(_ label: String) async throws {
            let sample = Sample(label)
            report.samples.append(sample)
            try writeReport()
            await log("\(label) · 进程 \(sample.footprint / UInt64(mib)) MiB · 可用 \(sample.available / mib) MiB · MLX 峰值 \((sample.mlx["peak"] ?? 0) / mib) MiB")
        }
        do {
            await log("Metal \(gpu.name) · 物理内存 \(report.deviceMemory / UInt64(mib)) MiB")
            try validate(store)
            try await checkpoint("加载前")
            try checkHeadroom(weightBytes + 768 * mib)
            let start = Date()
            let model = try await Qwen3Embedding.load(from: store)
            report.loadSeconds = Date().timeIntervalSince(start)
            try await checkpoint("加载后")
            let text = String(repeating: "工作记忆与注意控制。 The expedition crossed the river.\n", count: 100)
            for count in [256, 512, 1024] {
                try checkHeadroom(count == 1024 ? 768 * mib : 512 * mib)
                let result = try await model.embed(text, maxTokens: count)
                try validate(result, count: count)
                report.timings[count] = result.seconds
                try await checkpoint("\(count) tokens · \(String(format: "%.3f s", result.seconds))")
            }
            for index in 1...100 {
                try checkHeadroom(512 * mib)
                let result = try await model.embed("Passage \(index)\n" + text, maxTokens: 256)
                try validate(result, count: 256)
                report.continuousSeconds.append(result.seconds)
                if index.isMultiple(of: 10) {
                    try await checkpoint("连续向量化 \(index)/100")
                }
            }
            await log("真机验证通过")
        } catch {
            report.failure = error.localizedDescription
            try writeReport()
            throw error
        }
    }

    private static func validate(_ folder: URL) throws {
        let config = try JSONDecoder().decode(Config.self, from: Data(
            contentsOf: folder.appendingPathComponent("config.json")))
        let size = try folder.appendingPathComponent("model.safetensors")
            .resourceValues(forKeys: [.fileSizeKey]).fileSize
        guard config.model_type == "qwen3", config.hidden_size == 2560,
            config.quantization.bits == 8, config.quantization.group_size == 64,
            config.quantization.mode == "affine", size == weightBytes else {
            throw failure("请选择完整的 Qwen3-Embedding-4B-MLX-8bit 模型文件夹。")
        }
    }

    private static func validate(_ result: EmbeddingResult, count: Int) throws {
        let squaredNorm = result.vector.reduce(0.0) { $0 + Double($1) * Double($1) }
        guard result.tokens.count == count, result.vector.count == 2560,
            abs(squaredNorm.squareRoot() - 1) < 0.00001 else {
            throw failure("\(count)-token 样本的长度、维度或范数不符合预期。")
        }
    }

    private static func checkHeadroom(_ needed: Int) throws {
        let headroom = os_proc_available_memory()
        guard headroom >= needed else {
            throw failure("iPad 进程可用 \(headroom / mib) MiB，本次操作的内存预算为 \(needed / mib) MiB。")
        }
    }

    private static func failure(_ message: String) -> NSError {
        NSError(domain: "Qwen3Probe", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

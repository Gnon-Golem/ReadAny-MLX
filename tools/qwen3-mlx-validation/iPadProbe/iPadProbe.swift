import Foundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import Qwen3Embedding

@main
struct IPadProbeApp: App {
    var body: some Scene {
        WindowGroup { ProbeView() }
    }
}

private struct ProbeView: View {
    @State private var selecting = false
    @State private var busy = false
    @State private var lines: [String] = []
    @State private var startedFromCommand = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button("从文件导入模型文件夹") { selecting = true }
                    Button("运行真机验证") { run(importing: nil, benchmark: true) }
                }
                .disabled(busy)
                Section("运行日志") {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("Qwen3 Q8 验证")
            .fileImporter(isPresented: $selecting, allowedContentTypes: [.folder]) { result in
                switch result {
                case .success(let url): run(importing: url, benchmark: false)
                case .failure(let error): record(error.localizedDescription)
                }
            }
            .task {
                guard !startedFromCommand else { return }
                startedFromCommand = true
                if CommandLine.arguments.contains("--import-and-benchmark") {
                    run(importing: ProbeRun.documents.appendingPathComponent("IncomingModel"),
                        benchmark: true)
                } else if CommandLine.arguments.contains("--benchmark") {
                    run(importing: nil, benchmark: true)
                }
            }
        }
    }

    private func run(importing directory: URL?, benchmark: Bool) {
        guard !busy else { return }
        busy = true
        UIApplication.shared.isIdleTimerDisabled = true
        Task {
            defer {
                UIApplication.shared.isIdleTimerDisabled = false
                busy = false
            }
            do {
                if let directory {
                    record("正在复制模型文件…")
                    try await ProbeRun.importModel(from: directory)
                    record("模型导入完成")
                }
                if benchmark {
                    try await ProbeRun.benchmark { line in record(line) }
                }
            } catch {
                record("失败 \(error.localizedDescription)")
            }
        }
    }

    private func record(_ line: String) {
        lines.append(line)
        print("QWEN3_PROBE \(line)")
        fflush(nil)
    }
}

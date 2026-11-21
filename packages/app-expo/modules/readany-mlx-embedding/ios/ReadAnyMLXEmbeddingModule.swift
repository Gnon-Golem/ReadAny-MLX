import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

// The MLX build links this implementation into the app target so Xcode embeds the
// Swift package's Metal resource bundle. Other ReadAny builds omit the backend.
@objc public protocol ReadAnyMLXEmbeddingBackend: AnyObject {
    init()
    func status() -> [String: Bool]
    func importFolder(_ url: URL, completion: @escaping (NSError?) -> Void)
    func load(completion: @escaping (NSError?) -> Void)
    func embed(_ text: String, completion: @escaping ([NSNumber]?, NSError?) -> Void)
    func unload(completion: @escaping (NSError?) -> Void)
    func deleteModel(completion: @escaping (NSError?) -> Void)
}

public final class ReadAnyMLXEmbeddingModule: Module {
    private lazy var backend = (NSClassFromString("ReadAnyQwen3Backend") as? ReadAnyMLXEmbeddingBackend.Type)?.init()
    private var pickerDelegate: ModelFolderPicker?

    public func definition() -> ModuleDefinition {
        Name("ReadAnyMLXEmbedding")

        AsyncFunction("status") { (promise: Promise) in
            promise.resolve(self.backend?.status() ?? ["available": false, "imported": false, "loaded": false])
        }.runOnQueue(.main)

        AsyncFunction("importModel") { [self] (promise: Promise) in
            guard let backend = self.requireBackend(promise) else { return }
            guard self.pickerDelegate == nil,
                let presenter = self.appContext?.utilities?.currentViewController()
            else {
                promise.reject("ERR_MLX_PICKER", "The model folder picker cannot open right now.")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            let delegate = ModelFolderPicker { [weak self] url in
                self?.pickerDelegate = nil
                guard let url else { promise.resolve(false); return }
                backend.importFolder(url) { error in
                    if let error { promise.reject(error) } else { promise.resolve(true) }
                }
            }
            self.pickerDelegate = delegate
            picker.delegate = delegate
            presenter.present(picker, animated: true)
        }.runOnQueue(.main)

        AsyncFunction("load") { (promise: Promise) in
            self.requireBackend(promise)?.load { Self.finish(promise, $0) }
        }.runOnQueue(.main)

        AsyncFunction("embed") { (text: String, promise: Promise) in
            self.requireBackend(promise)?.embed(text) { vector, error in
                if let error { promise.reject(error) } else { promise.resolve(vector) }
            }
        }.runOnQueue(.main)

        AsyncFunction("unload") { (promise: Promise) in
            self.requireBackend(promise)?.unload { Self.finish(promise, $0) }
        }.runOnQueue(.main)

        AsyncFunction("deleteModel") { (promise: Promise) in
            self.requireBackend(promise)?.deleteModel { Self.finish(promise, $0) }
        }.runOnQueue(.main)
    }

    private func requireBackend(_ promise: Promise) -> ReadAnyMLXEmbeddingBackend? {
        guard let backend, backend.status()["available"] == true else {
            promise.reject("ERR_MLX_UNAVAILABLE", "MLX embedding requires the ReadAny MLX build on an iPad.")
            return nil
        }
        return backend
    }

    private static func finish(_ promise: Promise, _ error: NSError?) {
        if let error { promise.reject(error) } else { promise.resolve(nil) }
    }
}

private final class ModelFolderPicker: NSObject, UIDocumentPickerDelegate {
    private let finish: (URL?) -> Void

    init(finish: @escaping (URL?) -> Void) {
        self.finish = finish
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(urls.first)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(nil)
    }
}

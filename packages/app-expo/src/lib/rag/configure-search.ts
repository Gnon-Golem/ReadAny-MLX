import {
  clearSearchConfiguration,
  configureSearch,
  createBuiltinEmbeddingService,
  EmbeddingService,
  normalizeEmbeddingEndpoint,
} from "@readany/core/rag";
import { setLocalEmbeddingEngine } from "@readany/core/ai/local-embedding-service";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { MobileEmbeddingEngine } from "./native-mlx-embedding";

let nativeEmbeddingEngineLoaded = false;

export function ensureNativeEmbeddingEngine(): void {
  if (nativeEmbeddingEngineLoaded) return;

  // The router loads the individual native engine on first use.
  setLocalEmbeddingEngine(new MobileEmbeddingEngine());
  nativeEmbeddingEngineLoaded = true;
}

/**
 * Keep Reader Agent's query embedding service aligned with the active mobile
 * vector-model setting. Vectorization configures its own embedding requests,
 * so without this bridge a successfully vectorized book could still not be
 * searched semantically.
 *
 * The ONNX engine is dynamically loaded only when a built-in model is active.
 */
export async function configureRagSearchFromVectorModelStore(): Promise<void> {
  const state = useVectorModelStore.getState();
  const remoteModel = state.getSelectedVectorModel();

  if (!state.vectorModelEnabled) {
    clearSearchConfiguration();
    return;
  }

  if (state.vectorModelMode === "builtin" && state.selectedBuiltinModelId) {
    ensureNativeEmbeddingEngine();
    configureSearch(createBuiltinEmbeddingService(state.selectedBuiltinModelId));
    return;
  }

  if (state.vectorModelMode !== "remote" || !remoteModel) {
    clearSearchConfiguration();
    return;
  }

  configureSearch(
    new EmbeddingService({
      model: {
        id: remoteModel.modelId,
        name: remoteModel.name || remoteModel.modelId,
        dimensions: remoteModel.dimension ?? 0,
        maxTokens: 8192,
        provider: "openai",
      },
      apiKey: remoteModel.apiKey || "local",
      baseUrl: remoteModel.url,
    }),
    {
      kind: "remote",
      modelId: remoteModel.modelId,
      endpoint: normalizeEmbeddingEndpoint(remoteModel.url),
      dimensions: remoteModel.dimension ?? 0,
    },
  );
}

/** Subscribe once at application bootstrap so setting edits take effect immediately. */
export async function subscribeRagSearchConfiguration(): Promise<() => void> {
  await configureRagSearchFromVectorModelStore();
  return useVectorModelStore.subscribe(() => {
    void configureRagSearchFromVectorModelStore().catch((error) => {
      console.warn("[RAG] failed to configure search", error);
      clearSearchConfiguration();
    });
  });
}

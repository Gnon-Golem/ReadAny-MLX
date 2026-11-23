import { QWEN3_MLX_MODEL } from "@readany/core/ai/builtin-embedding-models";
import {
  type ILocalEmbeddingEngine,
  WebWorkerEmbeddingEngine,
} from "@readany/core/ai/local-embedding-service";
import { invoke } from "@tauri-apps/api/core";

export interface MlxModelStatus {
  available: boolean;
  imported: boolean;
  loaded: boolean;
}

type Request =
  | { operation: "status" | "load" | "unload" }
  | { operation: "importModel"; source: string }
  | { operation: "embed"; texts: string[] };

let modelStatus: MlxModelStatus | null = null;
const listeners = new Set<() => void>();

export function getMlxModelStatus(): MlxModelStatus | null {
  return modelStatus;
}

export function subscribeToMlxModelStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function requestMlxModel(request: Request) {
  const response = await invoke<{ status: MlxModelStatus; vectors?: number[][] }>("mlx_embedding", {
    request,
  });
  modelStatus = response.status;
  for (const listener of listeners) listener();
  return response;
}

export class DesktopEmbeddingEngine implements ILocalEmbeddingEngine {
  private readonly onnx: WebWorkerEmbeddingEngine;

  constructor(workerFactory: () => Worker) {
    this.onnx = new WebWorkerEmbeddingEngine(workerFactory);
  }

  init(): void {}

  async load(modelId: string, hfModelId: string, onProgress?: (progress: number) => void) {
    if (modelId !== QWEN3_MLX_MODEL.id) return this.onnx.load(modelId, hfModelId, onProgress);
    await requestMlxModel({ operation: "load" });
    onProgress?.(100);
  }

  async generate(
    modelId: string,
    texts: string[],
    onItemProgress?: (done: number, total: number) => void,
  ): Promise<number[][]> {
    if (modelId !== QWEN3_MLX_MODEL.id) return this.onnx.generate(modelId, texts, onItemProgress);
    const vectors: number[][] = [];
    const batchSize = 8;
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const response = await requestMlxModel({ operation: "embed", texts: batch });
      if (response.vectors?.length !== batch.length) throw new Error("Incomplete Qwen3 MLX batch.");
      vectors.push(...response.vectors);
      onItemProgress?.(vectors.length, texts.length);
    }
    return vectors;
  }

  async dispose(): Promise<void> {
    await this.onnx.dispose();
    if (modelStatus?.loaded) await requestMlxModel({ operation: "unload" });
  }

  async clearCache(hfModelId: string): Promise<void> {
    if (hfModelId === QWEN3_MLX_MODEL.hfModelId) {
      throw new Error("Qwen3 MLX uses imported model files and has no ONNX cache.");
    }
    await this.onnx.clearCache(hfModelId);
  }
}

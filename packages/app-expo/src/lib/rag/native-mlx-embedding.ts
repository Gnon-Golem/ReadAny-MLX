import { QWEN3_MLX_MODEL } from "@readany/core/ai/builtin-embedding-models";
import type { ILocalEmbeddingEngine } from "@readany/core/ai/local-embedding-service";
import { requireOptionalNativeModule } from "expo-modules-core";

export interface MLXModelStatus {
  available: boolean;
  imported: boolean;
  loaded: boolean;
}

interface MLXModule {
  status(): Promise<MLXModelStatus>;
  importModel(): Promise<boolean>;
  load(): Promise<void>;
  embed(text: string): Promise<number[]>;
  unload(): Promise<void>;
  deleteModel(): Promise<void>;
}

export const mlxModule = requireOptionalNativeModule<MLXModule>("ReadAnyMLXEmbedding");

export class MobileEmbeddingEngine implements ILocalEmbeddingEngine {
  private onnx: ILocalEmbeddingEngine | undefined;
  private pending = Promise.resolve();

  init(): void {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.then(() => undefined, () => undefined);
    return next;
  }

  private async loadOnnx(): Promise<ILocalEmbeddingEngine> {
    if (!this.onnx) {
      const { NativeOnnxEmbeddingEngine } = await import("./native-onnx-embedding-engine");
      this.onnx = new NativeOnnxEmbeddingEngine();
    }
    return this.onnx;
  }

  private getMLX(): MLXModule {
    if (!mlxModule) throw new Error("This build does not support Qwen3 MLX.");
    return mlxModule;
  }

  private async releaseMLX(): Promise<void> {
    if (mlxModule && (await mlxModule.status()).loaded) await mlxModule.unload();
  }

  load(modelId: string, hfModelId: string, onProgress?: (progress: number) => void): Promise<void> {
    return this.serialize(async () => {
      if (modelId === QWEN3_MLX_MODEL.id) {
        await this.onnx?.dispose();
        await this.getMLX().load();
        onProgress?.(100);
        return;
      }
      await this.releaseMLX();
      await (await this.loadOnnx()).load(modelId, hfModelId, onProgress);
    });
  }

  generate(modelId: string, texts: string[], onItemProgress?: (done: number, total: number) => void): Promise<number[][]> {
    return this.serialize(async () => {
      if (modelId !== QWEN3_MLX_MODEL.id) {
        await this.releaseMLX();
        return (await this.loadOnnx()).generate(modelId, texts, onItemProgress);
      }
      await this.onnx?.dispose();
      const model = this.getMLX();
      const vectors: number[][] = [];
      for (const text of texts) {
        vectors.push(await model.embed(text));
        onItemProgress?.(vectors.length, texts.length);
      }
      return vectors;
    });
  }

  dispose(): Promise<void> {
    return this.serialize(async () => {
      await this.releaseMLX();
      await this.onnx?.dispose();
    });
  }

  clearCache(hfModelId: string): Promise<void> {
    return this.serialize(async () => {
      if (hfModelId === QWEN3_MLX_MODEL.hfModelId) {
        await this.getMLX().deleteModel();
        return;
      }
      await (await this.loadOnnx()).clearCache(hfModelId);
    });
  }
}

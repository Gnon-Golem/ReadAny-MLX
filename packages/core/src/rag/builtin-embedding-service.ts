import { generateLocalEmbeddings, loadEmbeddingPipeline } from "../ai/local-embedding-service";
import { findBuiltinEmbeddingModel, QWEN3_MLX_MODEL } from "../ai/builtin-embedding-models";
import type { QueryEmbeddingService } from "./search";

/**
 * Adapts the platform's configured builtin embedding engine to RAG query search.
 * Vectorization and query embedding share the configured model and its index provenance.
 */
export function createBuiltinEmbeddingService(builtinModelId: string): QueryEmbeddingService {
  const model = findBuiltinEmbeddingModel(builtinModelId);
  if (!model) throw new Error(`Unknown built-in embedding model: ${builtinModelId}`);

  return {
    provenance: {
      kind: "builtin",
      modelId: model.id,
      dimensions: model.dimension,
    },
    async embed(text: string): Promise<number[]> {
      await loadEmbeddingPipeline(builtinModelId);
      const input = builtinModelId === QWEN3_MLX_MODEL.id
        ? `Instruct: Given a question about a book, retrieve relevant passages that answer the question.\nQuery: ${text}`
        : text;
      const [embedding] = await generateLocalEmbeddings(builtinModelId, [input]);
      if (!embedding?.length) {
        throw new Error(`Built-in embedding model ${builtinModelId} returned no embedding.`);
      }
      return embedding;
    },
  };
}

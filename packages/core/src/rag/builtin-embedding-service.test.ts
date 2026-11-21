import { beforeEach, describe, expect, it, vi } from "vitest";
import { QWEN3_MLX_MODEL } from "../ai/builtin-embedding-models";
import { disposeEmbeddingPipeline, generateLocalEmbeddings, setLocalEmbeddingEngine } from "../ai/local-embedding-service";
import { createBuiltinEmbeddingService } from "./builtin-embedding-service";

describe("createBuiltinEmbeddingService", () => {
  const load = vi.fn(async () => undefined);

  const generate = vi.fn(async (_modelId: string, texts: string[]) => texts.map(() => [1, 2]));

  beforeEach(async () => {
    await disposeEmbeddingPipeline();
    vi.clearAllMocks();
    setLocalEmbeddingEngine({
      init: () => undefined,
      load,
      generate,
      dispose: async () => undefined,
      clearCache: async () => undefined,
    });
  });

  it("generates query embeddings with the selected builtin model", async () => {
    const service = createBuiltinEmbeddingService("bge-small-zh-v1.5");
    await expect(service.embed("查询文本")).resolves.toEqual([1, 2]);
    expect(load).toHaveBeenCalledWith("bge-small-zh-v1.5", "Xenova/bge-small-zh-v1.5", undefined);
    expect(generate).toHaveBeenCalledWith("bge-small-zh-v1.5", ["查询文本"], undefined);
  });
  it("adds the Qwen3 retrieval instruction only to the query", async () => {
    const service = createBuiltinEmbeddingService(QWEN3_MLX_MODEL.id);
    await service.embed("什么是工作记忆？");
    await generateLocalEmbeddings(QWEN3_MLX_MODEL.id, ["书籍原文"]);
    expect(service.provenance).toEqual({
      kind: "builtin", modelId: QWEN3_MLX_MODEL.id, dimensions: 2560,
    });
    expect(load).toHaveBeenCalledWith(QWEN3_MLX_MODEL.id, QWEN3_MLX_MODEL.hfModelId, undefined);
    expect(generate).toHaveBeenNthCalledWith(
      1, QWEN3_MLX_MODEL.id,
      ["Instruct: Given a question about a book, retrieve relevant passages that answer the question.\nQuery: 什么是工作记忆？"],
      undefined,
    );
    expect(generate).toHaveBeenNthCalledWith(2, QWEN3_MLX_MODEL.id, ["书籍原文"], undefined);
  });
});

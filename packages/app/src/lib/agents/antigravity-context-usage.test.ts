import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAntigravityContextUsage,
  readAntigravityContextUsage,
  saveAntigravityContextUsage,
} from "./antigravity-context-usage";

describe("saved Antigravity context usage", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("restores the latest reported usage for the same chat and model", () => {
    saveAntigravityContextUsage("chat-1", "gemini-neon", { used: 23, size: 100 });
    saveAntigravityContextUsage("chat-1", "gemini-neon", { used: 28, size: 100 });
    expect(readAntigravityContextUsage("chat-1", "gemini-neon")).toEqual({ used: 28, size: 100 });
    expect(readAntigravityContextUsage("chat-1", "gemini-hydrogen")).toBeUndefined();
    expect(readAntigravityContextUsage("chat-2", "gemini-neon")).toBeUndefined();
    clearAntigravityContextUsage("chat-1");
    expect(readAntigravityContextUsage("chat-1", "gemini-neon")).toBeUndefined();
  });

  it("does not present invalid persisted values as real usage", () => {
    const key = "readany-antigravity-context-usage:chat-1";
    values.set(key, "invalid-json");
    expect(readAntigravityContextUsage("chat-1", "gemini-neon")).toBeUndefined();
    values.set(key, JSON.stringify({ model: "gemini-neon", used: 4, size: 0 }));
    expect(readAntigravityContextUsage("chat-1", "gemini-neon")).toBeUndefined();
  });
});

import { ParallelWebProvider } from "@readany/core/ai/research";
import { fetch } from "expo/fetch";

export function createExpoWebSearchProvider() {
  return new ParallelWebProvider((url, init) => fetch(url, init));
}

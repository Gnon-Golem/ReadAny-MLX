import {
  ParallelWebProvider,
  type WebRequestOptions,
  type WebSearchProvider,
} from "@readany/core/ai/research";
import { fetch } from "expo/fetch";
import { AppState } from "react-native";

async function foregroundRequest<T>(
  options: WebRequestOptions | undefined,
  request: (options: WebRequestOptions) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "background") cancel();
  });
  if (AppState.currentState === "background" || options?.signal?.aborted) cancel();
  options?.signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await request({ ...options, signal: controller.signal });
  } finally {
    subscription.remove();
    options?.signal?.removeEventListener("abort", cancel);
  }
}

export function createExpoWebSearchProvider(): WebSearchProvider {
  const provider = new ParallelWebProvider((url, init) => fetch(url, init));
  return {
    id: provider.id,
    search: (request, options) =>
      foregroundRequest(options, (scoped) => provider.search(request, scoped)),
    fetchPage: (url, options) =>
      foregroundRequest(options, (scoped) => provider.fetchPage(url, scoped)),
  };
}

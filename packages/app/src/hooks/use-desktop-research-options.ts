import { useSettingsStore } from "@/stores/settings-store";
import {
  ParallelWebProvider,
  ResearchCache,
  type ResearchOptions,
} from "@readany/core/ai/research";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useMemo } from "react";

const cache = new ResearchCache();

export function createDesktopParallelProvider(): ParallelWebProvider {
  return new ParallelWebProvider((url, init) => tauriFetch(url, { ...init, maxRedirections: 0 }));
}

export function useDesktopResearchOptions(): ResearchOptions {
  const mode = useSettingsStore((state) => state.webResearchMode);
  return useMemo(
    () => ({
      mode,
      createProvider: createDesktopParallelProvider,
      cache,
    }),
    [mode],
  );
}

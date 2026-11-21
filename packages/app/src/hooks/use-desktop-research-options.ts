import { useSettingsStore } from "@/stores/settings-store";
import {
  ParallelWebProvider,
  ResearchCache,
  type ResearchOptions,
} from "@readany/core/ai/research";
import { useMemo } from "react";

const cache = new ResearchCache();

export function useDesktopResearchOptions(): ResearchOptions {
  const mode = useSettingsStore((state) => state.webResearchMode);
  return useMemo(
    () => ({
      mode,
      createProvider: () => new ParallelWebProvider(),
      cache,
    }),
    [mode],
  );
}

import { createExpoWebSearchProvider } from "@/lib/platform/expo-web-search";
import { useSettingsStore } from "@/stores/settings-store";
import type { ResearchOptions } from "@readany/core/ai/research";
import { useMemo } from "react";

export function useExpoResearchOptions(): ResearchOptions {
  const mode = useSettingsStore((state) => state.webResearchMode);
  return useMemo(() => ({ mode, createProvider: createExpoWebSearchProvider }), [mode]);
}

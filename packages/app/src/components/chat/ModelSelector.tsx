/**
 * ModelSelector — inline model switcher for chat headers.
 * Shows all models across all endpoints, grouped by endpoint name.
 * Selecting a model from a different endpoint also switches the active endpoint.
 */
import { useSettingsStore } from "@/stores/settings-store";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  chatPickerItemClass,
  chatPickerMenuClass,
  chatPickerSelectedClass,
  chatPickerTriggerClass,
} from "./ChatOptionPicker";

export type ChatRuntime = "native" | "codex" | "antigravity";

export function ModelSelector({
  runtime = "native",
  onRuntimeChange,
}: {
  runtime?: ChatRuntime;
  onRuntimeChange?: (runtime: ChatRuntime) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { aiConfig, setActiveModel, setActiveEndpoint } = useSettingsStore();
  const currentModel = aiConfig.activeModel;
  const activeEndpointId = aiConfig.activeEndpointId;

  // Collect all endpoints that have models
  const endpointsWithModels = aiConfig.endpoints.filter((ep) => ep.models.length > 0);
  const totalModels = endpointsWithModels.reduce((sum, ep) => sum + ep.models.length, 0);
  const multipleEndpoints = endpointsWithModels.length > 1;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Derive display name: truncate long model names
  const displayName = currentModel
    ? currentModel.length > 20
      ? `${currentModel.slice(0, 18)}...`
      : currentModel
    : t("chat.currentModel");

  const canSwitch = Boolean(onRuntimeChange || totalModels > 1);
  const label = runtime === "antigravity" ? "Antigravity" : displayName;

  const handleSelect = (endpointId: string, model: string) => {
    if (endpointId !== activeEndpointId) {
      setActiveEndpoint(endpointId);
    }
    setActiveModel(model);
    onRuntimeChange?.("native");
    setOpen(false);
  };

  return (
    <div className="relative min-w-0" ref={popoverRef}>
      <button
        type="button"
        onClick={() => canSwitch && setOpen(!open)}
        className={`${chatPickerTriggerClass} ${
          canSwitch ? "cursor-pointer hover:bg-muted hover:text-foreground" : "cursor-default"
        }`}
        aria-label={onRuntimeChange ? t("chat.modelAndAgent") : undefined}
        aria-expanded={canSwitch ? open : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        title={runtime === "native" ? currentModel || t("chat.currentModel") : label}
      >
        <span className="max-w-[120px] truncate">{label}</span>
        {canSwitch && <ChevronDown className="size-3 shrink-0" />}
      </button>

      {open && canSwitch && (
        <div className={`absolute right-0 top-full z-50 mt-1.5 w-60 ${chatPickerMenuClass}`}>
          <div className="max-h-72 overflow-y-auto">
            {onRuntimeChange && endpointsWithModels.length > 0 && (
              <div className="px-2.5 py-1 text-xs text-muted-foreground">
                {t("chat.nativeAiMode")}
              </div>
            )}
            {endpointsWithModels.map((ep) => (
              <div key={ep.id}>
                {multipleEndpoints && (
                  <div className="px-2.5 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground first:pt-1">
                    {ep.name || ep.baseUrl}
                  </div>
                )}
                {ep.models.map((model) => {
                  const isActive =
                    runtime === "native" && model === currentModel && ep.id === activeEndpointId;
                  return (
                    <button
                      key={`${ep.id}-${model}`}
                      type="button"
                      onClick={() => handleSelect(ep.id, model)}
                      className={`${chatPickerItemClass} ${
                        isActive ? chatPickerSelectedClass : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="truncate">{model}</span>
                      {isActive && <Check className="size-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {onRuntimeChange && (
              <div className="mt-1 border-t pt-1">
                {(["antigravity", "codex"] as const).map((agent) => (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => {
                      onRuntimeChange(agent);
                      setOpen(false);
                    }}
                    className={`${chatPickerItemClass} ${agent === runtime ? chatPickerSelectedClass : "hover:bg-muted"}`}
                  >
                    {agent === "antigravity" ? "Antigravity" : "Codex"}
                    {agent === runtime && <Check className="size-3 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

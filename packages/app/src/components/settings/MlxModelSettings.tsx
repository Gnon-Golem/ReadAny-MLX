import { Button } from "@/components/ui/button";
import { useMlxDevelopmentBuild } from "@/lib/macos-mlx-build";
import {
  getMlxModelStatus,
  requestMlxModel,
  subscribeToMlxModelStatus,
} from "@/lib/rag/desktop-embedding";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { QWEN3_MLX_MODEL } from "@readany/core/ai/builtin-embedding-models";
import { open } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

export function MlxModelSettings() {
  const { t } = useTranslation();
  const enabled = useMlxDevelopmentBuild();
  const selected = useVectorModelStore(
    (state) => state.selectedBuiltinModelId === QWEN3_MLX_MODEL.id,
  );
  const status = useSyncExternalStore(subscribeToMlxModelStatus, getMlxModelStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (enabled)
      void requestMlxModel({ operation: "status" }).catch((err) => setError(String(err)));
  }, [enabled]);

  if (!enabled) return null;

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      setError(String(err));
    } finally {
      setPending(false);
    }
  }

  function importModel() {
    void run(async () => {
      const source = await open({ directory: true, multiple: false });
      if (source) await requestMlxModel({ operation: "importModel", source });
    });
  }

  function loadModel() {
    void run(async () => {
      await requestMlxModel({ operation: "load" });
      useVectorModelStore.getState().setSelectedBuiltinModelId(QWEN3_MLX_MODEL.id);
    });
  }

  function unloadModel() {
    void run(async () => {
      // Keep the selection and files. A later vector request reloads the model.
      await requestMlxModel({ operation: "unload" });
    });
  }

  return (
    <div
      className={`rounded-lg border p-3 ${selected ? "border-primary/50 bg-primary/5" : "border-border bg-background"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{QWEN3_MLX_MODEL.name} · MLX</span>
          <span className="text-xs text-muted-foreground">
            {t("settings.vm_dimension", { dim: QWEN3_MLX_MODEL.dimension })}
          </span>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {status?.loaded
              ? t("settings.vm_loaded")
              : status?.imported
                ? t("settings.vm_mlxImported")
                : status?.available
                  ? t("settings.vm_mlxNeedsImport")
                  : null}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
          {pending && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
          {!status?.imported && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !status?.available}
              onClick={importModel}
            >
              {t("settings.vm_mlxImport")}
            </Button>
          )}
          {status?.imported && (!selected || !status.loaded) && (
            <Button size="sm" variant="outline" disabled={pending} onClick={loadModel}>
              {t("settings.vm_mlxLoadUse")}
            </Button>
          )}
          {status?.loaded && (
            <Button size="sm" variant="outline" disabled={pending} onClick={unloadModel}>
              {t("settings.vm_mlxUnload")}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t(QWEN3_MLX_MODEL.descriptionKey)}</p>
      {(error || status?.available === false) && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error || t("settings.vm_mlxUnavailable")}
        </p>
      )}
    </div>
  );
}

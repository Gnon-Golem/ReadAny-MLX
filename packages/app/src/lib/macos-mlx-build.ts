import { getIdentifier } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

let developmentBuild: Promise<boolean> | undefined;

export function isMlxDevelopmentBuild(): Promise<boolean> {
  developmentBuild ??= getIdentifier()
    .then((identifier) => identifier === "com.readany.mlx.macos.dev")
    .catch(() => false);
  return developmentBuild;
}

export function useMlxDevelopmentBuild(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void isMlxDevelopmentBuild().then(setEnabled);
  }, []);
  return enabled;
}

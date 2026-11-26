export const ANTIGRAVITY_PERMISSIONS = ["review", "default", "auto", "full"] as const;

export type AntigravityPermissionMode = (typeof ANTIGRAVITY_PERMISSIONS)[number];

export const ANTIGRAVITY_PERMISSION_PREFERENCE = "readany-antigravity-last-permission";

export function isAntigravityPermissionMode(value: unknown): value is AntigravityPermissionMode {
  return ANTIGRAVITY_PERMISSIONS.some((mode) => mode === value);
}

export function antigravityExecutionMode(permission: AntigravityPermissionMode) {
  if (permission === "auto") return "auto";
  return permission === "full" ? "accept-edits" : "default";
}

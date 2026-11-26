export interface AntigravityContextUsage {
  used: number;
  size: number;
}

const usageKey = (chatId: string) => `readany-antigravity-context-usage:${chatId}`;

export function readAntigravityContextUsage(
  chatId: string,
  model: string,
): AntigravityContextUsage | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(usageKey(chatId)) ?? "null");
    if (
      value?.model === model &&
      Number.isSafeInteger(value.used) &&
      value.used >= 0 &&
      Number.isSafeInteger(value.size) &&
      value.size > 0
    ) {
      return { used: value.used, size: value.size };
    }
  } catch {
    // Live usage remains available if browser storage is unavailable.
  }
}

export function saveAntigravityContextUsage(
  chatId: string,
  model: string,
  usage: AntigravityContextUsage,
) {
  try {
    localStorage.setItem(usageKey(chatId), JSON.stringify({ ...usage, model }));
  } catch {
    // The toolbar can still render the live value.
  }
}

export function clearAntigravityContextUsage(chatId: string) {
  try {
    localStorage.removeItem(usageKey(chatId));
  } catch {
    // The chat can still be deleted if browser storage is unavailable.
  }
}

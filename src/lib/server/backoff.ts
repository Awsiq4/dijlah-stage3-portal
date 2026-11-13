export const MAX_ATTEMPTS = 5;
export const MAX_DELAY_MS = 5 * 60 * 1000;

export function nextDelayMs(attempts: number, retryAfterSec?: number): number {
  if (retryAfterSec && retryAfterSec > 0) return retryAfterSec * 1000;
  const base = Math.min(1000 * Math.pow(2, Math.max(0, attempts - 1)), MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(base + jitter, MAX_DELAY_MS);
}

export function shouldRetry(attempts: number, telegramError?: {code?: number; description?: string}): boolean {
  if (attempts >= MAX_ATTEMPTS) return false;
  if (!telegramError) return true;
  if (telegramError.code === 429) return true;
  if (telegramError.code === 502 || telegramError.code === 503 || telegramError.code === 504) return true;
  if (telegramError.code === 400 || telegramError.code === 401 || telegramError.code === 403 || telegramError.code === 404) return false;
  return true;
}

export function isBlockedError(telegramError?: {code?: number; description?: string}): boolean {
  return telegramError?.code === 403 || /blocked|deactivated|chat not found/i.test(telegramError?.description || "");
}

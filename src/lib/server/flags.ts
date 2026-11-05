export const TELEGRAM_BOT_ENABLED = process.env.TELEGRAM_BOT_ENABLED === "true";
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "";
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
export const SUBSCRIPTION_SECRET = process.env.SUBSCRIPTION_SECRET || "";
export const ADMIN_SECRET = process.env.ADMIN_API_SECRET || "";
export const WORKER_SECRET = process.env.WORKER_SECRET || "";
export const DATABASE_URL = process.env.DATABASE_URL || "";
export const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || "https://dijlah-stage3-portal.vercel.app";
export const PORTAL_ALLOWED_ORIGINS: string[] = (process.env.PORTAL_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
export const QSTASH_TOKEN = process.env.QSTASH_TOKEN || "";
export const QSTASH_URL = process.env.QSTASH_URL || "";

export function botConfigured(): boolean {
  return Boolean(BOT_TOKEN && BOT_USERNAME);
}
export function dbConfigured(): boolean {
  return Boolean(DATABASE_URL);
}
export function telegramServiceEnabled(): boolean {
  return TELEGRAM_BOT_ENABLED && botConfigured() && dbConfigured();
}
export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

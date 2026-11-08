import {BOT_TOKEN} from "./flags.ts";

const API_BASE = "https://api.telegram.org";

export type TgError = {code?: number; description?: string};

export async function tgFetch<T>(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<{ok: boolean; result?: T; error?: TgError; retryAfter?: number}> {
  if (!BOT_TOKEN) return {ok: false, error: {description: "TELEGRAM_BOT_TOKEN is not configured"}};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(params),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    clearTimeout(t);
    if (res.ok && data.ok) return {ok: true, result: data.result as T};
    return {
      ok: false,
      error: {code: data.error_code, description: data.description},
      retryAfter: data.parameters?.retry_after,
    };
  } catch (err) {
    clearTimeout(t);
    return {ok: false, error: {description: err instanceof Error ? err.message : "network error"}};
  }
}

export function sendMessage(chatId: number, text: string, opts: {parseMode?: string; replyMarkup?: unknown} = {}) {
  return tgFetch<{message_id: number}>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode,
    disable_web_page_preview: true,
    ...(opts.replyMarkup ? {reply_markup: opts.replyMarkup} : {}),
  });
}

export function setWebhook(webhookUrl: string, secret: string) {
  return tgFetch("setWebhook", {url: webhookUrl, secret_token: secret, allowed_updates: ["message", "callback_query"]});
}

export function deleteWebhook() {
  return tgFetch("deleteWebhook", {});
}

export function getMe() {
  return tgFetch<{id: number; username: string; is_bot: boolean}>("getMe", {});
}

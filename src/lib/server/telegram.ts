import {BOT_TOKEN} from "./flags.ts";
import {styleTelegramReplyMarkup} from "./telegram-button-style.ts";

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
      body: JSON.stringify(params.reply_markup === undefined
        ? params
        : {...params, reply_markup: styleTelegramReplyMarkup(params.reply_markup)}),
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

// Telegram's command-menu button beside the chat input.
let lastCommandsSync = 0;
export async function syncBotCommands(): Promise<boolean> {
  const now = Date.now();
  if (now - lastCommandsSync < 30 * 60_000) return true;
  lastCommandsSync = now;
  const commands = [
    {command:"start",description:"فتح القائمة الرئيسية"},
    {command:"menu",description:"القائمة الرئيسية"},
    {command:"section",description:"تغيير الشعبة"},
    {command:"settings",description:"إعدادات الإشعارات"},
    {command:"help",description:"المساعدة"},
  ];
  const done = await tgFetch("setMyCommands",{commands});
  if (!done.ok) {lastCommandsSync=0;return false;}
  const menu = await tgFetch("setChatMenuButton",{menu_button:{type:"commands"}});
  if (!menu.ok) {lastCommandsSync=0;return false;}
  return true;
}

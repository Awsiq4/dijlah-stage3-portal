// Telegram Bot API 9.x: inline button style is one of "primary", "success", "danger".
// Calm Academic: color only high-signal actions; ordinary navigation stays native.
// This is presentation-only. Never change callback data, URLs, permissions or prefs.
export type InlineButtonStyle = "primary" | "success" | "danger";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function styleForTelegramButton(button: Record<string, unknown>): InlineButtonStyle | null {
  const data = typeof button.callback_data === "string" ? button.callback_data : "";
  const label = typeof button.text === "string" ? button.text : "";
  // Links, web-app buttons and unsupported button types stay neutral.
  if (!data) return null;

  // Destructive or privacy-sensitive operations — keep Cancel and Back neutral.
  if (/^it:del(?:ok)?:/.test(data) || data.startsWith("qmanage:delete:") || data === "stu:stop" || data === "flow:discard") return "danger";
  if (data === "own:notif:toggle" && label.includes("تعطيل")) return "danger";

  // Final publishing, successful state transitions and explicit activation.
  if (data.startsWith("pub:") || data === "pdf:new" ||
      /^sup:o:status:[^:]+:resolved$/.test(data) ||
      (data.startsWith("it:arch:") && label.includes("استعادة")) ||
      (data.startsWith("sec:") && label.includes("إعادة تفعيل")) ||
      (data === "own:notif:toggle" && label.includes("تفعيل"))) return "success";

  // Most-used entry points and actions — deliberately not every menu item.
  if (data === "stu:ann" || data === "stu:lec" ||
      data === "adm:new" || data === "adm:quick" || data === "adm:ann" ||
      data === "stu:sched:today" || data === "flow:resume" ||
      (data === "own:stats" && label.includes("إحصائيات")) ||
      (data === "sup:o:home" && label.includes("إدارة الدعم")) ||
      data === "sup:o:list:pending:0" ||
      data.startsWith("sup:o:reply:") || data.startsWith("sup:s:reply:")) return "primary";

  return null;
}

/** Decorate Telegram inline keyboards at transport time, including queued support jobs.
 * Keeps explicit styles and non-inline keyboards untouched. Idempotent and non-mutating.
 */
export function styleTelegramReplyMarkup(markup: unknown): unknown {
  if (!isObject(markup) || !Array.isArray(markup.inline_keyboard)) return markup;
  return {
    ...markup,
    inline_keyboard: markup.inline_keyboard.map(row =>
      Array.isArray(row)
        ? row.map(button => {
          if (!isObject(button) || Object.hasOwn(button, "style")) return button;
          const style = styleForTelegramButton(button);
          return style ? {...button, style} : button;
        })
        : row
    ),
  };
}

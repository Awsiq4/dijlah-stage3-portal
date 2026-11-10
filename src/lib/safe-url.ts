// Reject ambiguous browser URL syntax before parsing relative or HTTPS links.
export function safeFileUrl(value: string): string {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (!/^https:\/\//i.test(value)) return "";
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function adminReturnPath(value: string | null): string {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return "/admin";
  if (!/^\/(?:admin|admin-legacy)(?:\/|$)/.test(value)) return "/admin";
  const path = new URL(value, "https://portal.invalid").pathname;
  return /^\/(?:admin|admin-legacy)(?:\/|$)/.test(path) ? path : "/admin";
}

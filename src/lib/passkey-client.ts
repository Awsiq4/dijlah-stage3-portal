export async function passkeyRequest<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/passkeys", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({action, ...body}),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "تعذّر إكمال العملية. جرّب مجدداً.");
  return data as T;
}

// Verified aliases of the SAME Vercel production project.
// dj3.top is the custom domain; the vercel.app alias remains active.
const officialHosts = new Set(["dj3.top", "dijlah-stage3-portal.vercel.app"]);
const path = "/api/telegram/webhook";

function parseSafeEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password
      || url.pathname !== path || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function expectedProductionWebhook(baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:" || base.port || base.username || base.password
      || !officialHosts.has(base.hostname) || !["", "/"].includes(base.pathname)
      || base.search || base.hash) return null;
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

export function isOfficialProductionWebhook(value: string): boolean {
  const url = parseSafeEndpoint(value);
  return Boolean(url && officialHosts.has(url.hostname));
}

export function isKnownProjectPreviewWebhook(value: string): boolean {
  const url = parseSafeEndpoint(value);
  if (!url) return false;
  return url.hostname === "dijlah-stage3-portal-awsiq4.vercel.app"
    || /^dijlah-stage3-portal-[a-z0-9-]+-awsiq4\.vercel\.app$/i.test(url.hostname);
}

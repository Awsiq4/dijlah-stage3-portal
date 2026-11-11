import {NextResponse} from "next/server";
import type {NextRequest} from "next/server";

export function isAdminPage(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/")
      || pathname === "/admin-legacy" || pathname.startsWith("/admin-legacy/");
}

function renderAdminWithCsp(req: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const script = `script-src 'self' 'nonce-${nonce}'` +
    (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "");
  const policy = [
    "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    script, "script-src-attr 'none'",
  ].join("; ");
  const headers = new Headers(req.headers);
  // Next.js reads this request header to apply the nonce to its bootstrap scripts.
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({request: {headers}});
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export function middleware(req: NextRequest) {
  const {pathname} = req.nextUrl;
  const hasSession = Boolean(req.cookies.get("portal_session")?.value);
  if (pathname.startsWith("/api/admin/")) {
    if (pathname === "/api/admin/login" || pathname === "/api/admin/health" || pathname === "/api/admin/setup" || pathname === "/api/admin/reset-password" || pathname === "/api/admin/request-password-reset") return NextResponse.next();
    // The upload route authenticates browser issuance and verifies Blob callbacks itself.
    if (pathname === "/api/admin/upload") return NextResponse.next();
    if (!hasSession && !req.headers.get("x-admin-secret")) {
      return NextResponse.json({error: "unauthorized"}, {status: 401});
    }
    return NextResponse.next();
  }
  if (isAdminPage(pathname)) {
    const publicAdminPage = ["/admin/login", "/admin/setup", "/admin/reset-password", "/admin/forgot-password"].includes(pathname);
    if (!publicAdminPage && !hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return renderAdminWithCsp(req);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/admin-legacy/:path*", "/api/admin/:path*"],
};

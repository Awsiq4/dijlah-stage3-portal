import {NextResponse} from "next/server";
import type {NextRequest} from "next/server";

export function isAdminPage(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/")
      || pathname === "/admin-legacy" || pathname.startsWith("/admin-legacy/");
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
    if (pathname === "/admin/login" || pathname === "/admin/setup" || pathname === "/admin/reset-password" || pathname === "/admin/forgot-password") return NextResponse.next();
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/admin-legacy/:path*", "/api/admin/:path*"],
};

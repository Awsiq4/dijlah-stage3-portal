import {NextResponse} from "next/server";
import type {NextRequest} from "next/server";

export function middleware(req: NextRequest) {
  const {pathname} = req.nextUrl;
  const hasSession = Boolean(req.cookies.get("portal_session")?.value);
  if (pathname.startsWith("/api/admin/")) {
    if (pathname === "/api/admin/login" || pathname === "/api/admin/health") return NextResponse.next();
    if (!hasSession && !req.headers.get("x-admin-secret")) {
      return NextResponse.json({error: "unauthorized"}, {status: 401});
    }
    return NextResponse.next();
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (pathname === "/admin/login") return NextResponse.next();
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
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

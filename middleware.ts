import { NextResponse, type NextRequest } from "next/server";

function getHost(req: NextRequest) {
  return (req.headers.get("host") || "").toLowerCase();
}

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/logo") ||
    pathname.startsWith("/images") ||
    pathname.includes(".")
  );
}

export function middleware(req: NextRequest) {
  const host = getHost(req);
  const pathname = req.nextUrl.pathname;

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  const isAdminHost =
    host === "admin.moovurides.co.za" ||
    host.startsWith("admin.localhost") ||
    host.startsWith("admin.127.0.0.1");

  const isDriverHost =
    host === "driver.moovurides.co.za" ||
    host.startsWith("driver.localhost") ||
    host.startsWith("driver.127.0.0.1");

  const url = req.nextUrl.clone();

  if (isAdminHost && !pathname.startsWith("/admin")) {
    url.pathname = pathname === "/" ? "/admin" : `/admin${pathname}`;
    return NextResponse.rewrite(url);
  }

  if (isDriverHost && !pathname.startsWith("/driver")) {
    url.pathname = pathname === "/" ? "/driver" : `/driver${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
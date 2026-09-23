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

  const retiredMutations = ["/api/driver/apply", "/api/driver/profile/save", "/api/driver/documents/upload", "/api/driver/account/delete", "/api/admin/applications/action", "/api/admin/applications/create-driver", "/api/admin/driver-verification", "/api/admin/driver-corrections", "/api/admin/driver-document-review", "/api/admin/driver-docs/upload", "/api/admin/drivers/create"];
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && retiredMutations.includes(pathname)) {
    return NextResponse.json({ error: "Use the versioned Driver onboarding and Admin review flow." }, { status: 410, headers: { "Cache-Control": "no-store" } });
  }
  if (["/driver/apply", "/driver/complete-profile"].includes(pathname) || ["/apply", "/complete-profile"].includes(pathname) && host.startsWith("driver.")) {
    const destination = req.nextUrl.clone(); destination.pathname = "/driver/onboarding";
    return NextResponse.redirect(destination);
  }

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

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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

export async function middleware(req: NextRequest) {
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

  // Work out what internal route this subdomain should map to
  let effectivePath = pathname;

  if (isAdminHost && !pathname.startsWith("/admin")) {
    effectivePath = pathname === "/" ? "/admin" : `/admin${pathname}`;
  }

  if (isDriverHost && !pathname.startsWith("/driver")) {
    effectivePath = pathname === "/" ? "/driver" : `/driver${pathname}`;
  }

  // Protect admin routes except login
  const isAdminRoute = effectivePath.startsWith("/admin");
  const isAdminLoginRoute = effectivePath === "/admin/login";

  const res = NextResponse.next();

  if (isAdminRoute && !isAdminLoginRoute) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => {
              res.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      const loginUrl = req.nextUrl.clone();

      // On admin subdomain, send to /login instead of /admin/login in the browser URL
      if (isAdminHost) {
        loginUrl.pathname = "/login";
      } else {
        loginUrl.pathname = "/admin/login";
      }

      loginUrl.searchParams.set("next", effectivePath);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Rewrite admin subdomain -> /admin/*
  if (isAdminHost && !pathname.startsWith("/admin")) {
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = effectivePath;
    return NextResponse.rewrite(rewriteUrl, { headers: res.headers });
  }

  // Rewrite driver subdomain -> /driver/*
  if (isDriverHost && !pathname.startsWith("/driver")) {
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = effectivePath;
    return NextResponse.rewrite(rewriteUrl, { headers: res.headers });
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
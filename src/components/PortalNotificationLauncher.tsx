"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import EnablePushButton from "@/components/EnablePushButton";

function getRoleFromPath(pathname: string): "admin" | "driver" | "customer" | null {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/driver")) return "driver";

  const customerPaths = [
    "/book",
    "/ride",
    "/ride-confirm",
    "/shared-trip",
    "/customer",
    "/login",
  ];

  if (customerPaths.some((path) => pathname.startsWith(path))) return "customer";

  return null;
}

export default function PortalNotificationLauncher() {
  const pathname = usePathname();

  const role = useMemo(() => getRoleFromPath(pathname), [pathname]);

  if (!role) return null;

  const hideOnAuthOnlyScreens =
    pathname === "/driver/login" ||
    pathname === "/customer/auth" ||
    pathname === "/login";

  if (hideOnAuthOnlyScreens) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9998]">
      <EnablePushButton role={role} />
    </div>
  );
}
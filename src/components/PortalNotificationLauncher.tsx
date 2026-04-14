"use client";

import { usePathname } from "next/navigation";
import EnablePushButton from "@/components/EnablePushButton";

export default function PortalNotificationLauncher() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return (
      <div className="fixed bottom-4 right-4 z-[9998]">
        <EnablePushButton role="admin" />
      </div>
    );
  }

  if (pathname.startsWith("/driver")) {
    return (
      <div className="fixed bottom-4 right-4 z-[9998]">
        <EnablePushButton role="driver" />
      </div>
    );
  }

  return null;
}
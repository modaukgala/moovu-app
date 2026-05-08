"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/driver", label: "Home" },
  { href: "/driver/history", label: "Trips" },
  { href: "/driver/earnings", label: "Earnings" },
  { href: "/driver/complete-profile", label: "Account" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/driver") return pathname === "/driver";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DriverBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="moovu-customer-bottom-nav moovu-driver-bottom-nav"
      aria-label="Driver navigation"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "moovu-customer-nav-item active" : "moovu-customer-nav-item"}
          >
            <span className="moovu-customer-nav-dot" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

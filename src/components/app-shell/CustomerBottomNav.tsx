"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck2, Home, MapPinned, UserRound } from "lucide-react";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/book", label: "Book", icon: MapPinned },
  { href: "/ride/history", label: "Trips", icon: CalendarCheck2 },
  { href: "/account", label: "Account", icon: UserRound },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function CustomerBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="moovu-customer-bottom-nav" aria-label="Customer navigation">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "moovu-customer-nav-item active" : "moovu-customer-nav-item"}
          >
            <Icon className="moovu-customer-nav-icon" aria-hidden="true" />
            <span className="moovu-customer-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

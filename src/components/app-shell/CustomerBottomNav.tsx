"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home" },
  { href: "/book", label: "Book" },
  { href: "/ride/history", label: "Trips" },
  { href: "/customer/auth", label: "Account" },
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


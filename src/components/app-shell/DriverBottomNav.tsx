"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, House, ListChecks, WalletCards } from "lucide-react";

const items = [
  { href: "/driver", label: "Home", icon: House },
  { href: "/driver/history", label: "Trips", icon: ListChecks },
  { href: "/driver/earnings", label: "Earnings", icon: WalletCards },
  { href: "/driver/account", label: "Account", icon: CircleUserRound },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/driver") return pathname === "/driver";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DriverBottomNav() {
  const pathname = usePathname();

  return (
    <>
      <div className="mx-auto mb-[88px] mt-6 flex w-full max-w-xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 text-xs font-bold text-slate-500">
        <Link href="/driver/privacy-policy" className="hover:text-[var(--moovu-primary)]">
          Privacy
        </Link>
        <Link href="/driver/terms" className="hover:text-[var(--moovu-primary)]">
          Terms &amp; T&amp;Cs
        </Link>
        <Link href="/driver/contact" className="hover:text-[var(--moovu-primary)]">
          Contact
        </Link>
      </div>

      <nav
        className="moovu-customer-bottom-nav moovu-driver-bottom-nav"
        aria-label="Driver navigation"
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={active ? "moovu-customer-nav-item active" : "moovu-customer-nav-item"}
            >
              <Icon className="moovu-customer-nav-icon" aria-hidden="true" />
              <span className="moovu-customer-nav-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

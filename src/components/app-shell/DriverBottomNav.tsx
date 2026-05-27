"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/driver", label: "Home" },
  { href: "/driver/history", label: "Trips" },
  { href: "/driver/earnings", label: "Earn" },
  { href: "/driver/subscriptions", label: "Subs" },
  { href: "/driver/complete-profile", label: "Acct" },
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
    </>
  );
}

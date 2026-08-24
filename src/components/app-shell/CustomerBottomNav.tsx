"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

type CustomerBottomNavProps = {
  className?: string;
  visibilityMode?: "auto" | "controlled" | "always";
  visible?: boolean;
};

export default function CustomerBottomNav({
  className = "",
  visibilityMode = "auto",
  visible = true,
}: CustomerBottomNavProps) {
  const pathname = usePathname();
  const [autoVisible, setAutoVisible] = useState(false);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    if (visibilityMode !== "auto") return;

    let animationFrame = 0;

    const isScrollable = () => (
      document.documentElement.scrollHeight > window.innerHeight + 8
      || document.body.scrollHeight > window.innerHeight + 8
    );

    const updateInitialState = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        lastScrollTopRef.current = Math.max(0, window.scrollY);
        setAutoVisible(!isScrollable());
      });
    };

    const handleScroll = () => {
      const nextScrollTop = Math.max(0, window.scrollY);
      const delta = nextScrollTop - lastScrollTopRef.current;

      if (!isScrollable()) setAutoVisible(true);
      else if (nextScrollTop <= 4) setAutoVisible(false);
      else if (delta > 5) setAutoVisible(true);
      else if (delta < -5) setAutoVisible(false);

      lastScrollTopRef.current = nextScrollTop;
    };

    updateInitialState();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updateInitialState);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateInitialState);
    resizeObserver?.observe(document.body);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateInitialState);
      resizeObserver?.disconnect();
    };
  }, [pathname, visibilityMode]);

  const navigationVisible = visibilityMode === "always"
    ? true
    : visibilityMode === "controlled"
      ? visible
      : autoVisible;
  const visibilityClass = visibilityMode === "always"
    ? ""
    : `customer-scroll-nav${navigationVisible ? " is-visible" : ""}`;

  return (
    <nav
      className={`moovu-customer-bottom-nav ${visibilityClass} ${className}`.trim()}
      aria-label="Customer navigation"
      aria-hidden={!navigationVisible}
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "moovu-customer-nav-item active" : "moovu-customer-nav-item"}
            tabIndex={navigationVisible ? undefined : -1}
          >
            <Icon className="moovu-customer-nav-icon" aria-hidden="true" />
            <span className="moovu-customer-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

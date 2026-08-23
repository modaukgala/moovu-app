"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  CarFront,
  FileCheck2,
  Headphones,
  History,
  House,
  ReceiptText,
  UserRound,
  WalletCards,
} from "lucide-react";

type DriverSectionTabsProps = {
  section: "trips" | "money" | "account";
};

const tabs = {
  trips: [
    { href: "/driver/history", label: "Trip history", icon: History },
    { href: "/driver/trip-offers", label: "Offers", icon: CarFront },
    { href: "/driver", label: "Home", icon: House },
  ],
  money: [
    { href: "/driver/earnings", label: "Earnings", icon: WalletCards },
    { href: "/driver/commission-payments", label: "Commission", icon: BadgeDollarSign },
    { href: "/driver/subscriptions", label: "Plans", icon: ReceiptText },
  ],
  account: [
    { href: "/driver/account", label: "Account", icon: UserRound },
    { href: "/driver/complete-profile", label: "Documents", icon: FileCheck2 },
    { href: "/driver/contact", label: "Support", icon: Headphones },
  ],
} as const;

export default function DriverSectionTabs({ section }: DriverSectionTabsProps) {
  const pathname = usePathname();

  return (
    <nav className="driver-context-tabs" aria-label={`${section} navigation`}>
      {tabs[section].map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CarFront, CircleHelp, CreditCard, FileText, Headphones, History, Home, Info, LogOut, MapPinned, ShieldCheck, UserRound, X } from "lucide-react";

type Props = { open: boolean; onClose: () => void; loggedIn: boolean; name?: string; contact?: string; onLogout?: () => void };

export default function CustomerDrawer({ open, onClose, loggedIn, name, contact, onLogout }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  const initials = (name || "MOOVU Customer").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: loggedIn ? "/book" : "/customer/auth?next=/book", label: "Book a ride", icon: MapPinned },
    { href: loggedIn ? "/ride/history" : "/customer/auth?next=/ride/history", label: "Trips", icon: History },
    { href: loggedIn ? "/account" : "/customer/auth?next=/account", label: "Account", icon: UserRound },
    { href: loggedIn ? "/account/payment-methods" : "/customer/auth?next=/account/payment-methods", label: "Payment methods", icon: CreditCard },
    { href: "/contact", label: "Safety", icon: ShieldCheck },
    { href: "/contact", label: "Help and support", icon: Headphones },
    { href: "/privacy-policy", label: "Privacy", icon: FileText },
    { href: "/terms", label: "About MOOVU", icon: Info },
  ];
  return <div className="customer-drawer-layer" role="presentation" onClick={onClose}><aside className="customer-drawer" role="dialog" aria-modal="true" aria-label="Customer menu" onClick={(event) => event.stopPropagation()}><div className="customer-drawer-head"><div className="customer-drawer-profile"><span className="customer-drawer-avatar">{initials}</span><div><strong>{name || "MOOVU Customer"}</strong><small>{contact || "Kasi Rides"}</small></div></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close menu"><X /></button></div><nav>{links.map(({ href, label, icon: Icon }) => <Link href={href} key={`${href}-${label}`} onClick={onClose}><Icon aria-hidden="true" /><span>{label}</span></Link>)}</nav><div className="customer-drawer-footer">{loggedIn && onLogout ? <button type="button" onClick={onLogout}><LogOut aria-hidden="true" /><span>Log out</span></button> : <Link href="/customer/auth?next=/book"><CircleHelp aria-hidden="true" /><span>Customer sign in</span></Link>}<Link href="/driver/apply"><CarFront aria-hidden="true" /><span>Become a driver</span></Link></div></aside></div>;
}

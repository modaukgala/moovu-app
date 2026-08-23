"use client";

import { useEffect, useRef } from "react";
import { BadgeDollarSign, CarFront, FileCheck2, Headphones, History, LogOut, ReceiptText, Settings, ShieldCheck, WalletCards, X } from "lucide-react";
import type { Driver } from "./types";

export default function DriverDrawer({ open, driver, levelLabel, completedTrips, onClose, onNavigate, onLogout }: { open: boolean; driver: Driver | null; levelLabel: string; completedTrips: number; onClose: () => void; onNavigate: (path: string) => void; onLogout: () => void }) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelectorAll<HTMLElement>("button, a, [tabindex]:not([tabindex='-1'])");
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open || !driver) return null;
  const navigate = (path: string) => { onClose(); onNavigate(path); };
  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ") || "MOOVU Driver";
  const verified = ["approved", "verified", "active"].includes(String(driver.verification_status ?? driver.status ?? "").toLowerCase());
  return (
    <div className="driver-drawer-backdrop" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="driver-drawer"
        aria-label="Driver control centre"
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => { touchStartXRef.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const start = touchStartXRef.current;
          const end = event.changedTouches[0]?.clientX;
          if (start != null && end != null && start - end > 70) onClose();
          touchStartXRef.current = null;
        }}
      >
        <div className="driver-drawer-header"><div className="driver-drawer-avatar">{(driver.first_name?.[0] ?? "M").toUpperCase()}{(driver.last_name?.[0] ?? "D").toUpperCase()}</div><button type="button" onClick={onClose} aria-label="Close driver menu"><X aria-hidden="true" /></button></div>
        <div className="mt-4 flex items-center gap-2">
          <h2 className="!mt-0">{name}</h2>
          {verified && <ShieldCheck className="h-5 w-5 text-emerald-600" aria-label="Verified MOOVU Driver" />}
        </div>
        <p>{levelLabel} driver · {completedTrips.toLocaleString()} completed trips</p>
        {driver.phone && <p>{driver.phone}</p>}
        <div className="driver-drawer-links">
          <button type="button" onClick={() => navigate("/driver/earnings")}><WalletCards aria-hidden="true" />Earnings</button>
          <button type="button" onClick={() => navigate("/driver/history")}><History aria-hidden="true" />Trip history</button>
          <button type="button" onClick={() => navigate("/driver/trip-offers")}><CarFront aria-hidden="true" />Trip offers</button>
          <button type="button" onClick={() => navigate("/driver/commission-payments")}><BadgeDollarSign aria-hidden="true" />Commission payments</button>
          <button type="button" onClick={() => navigate("/driver/subscriptions")}><ReceiptText aria-hidden="true" />Subscriptions</button>
          <button type="button" onClick={() => navigate("/driver/complete-profile")}><FileCheck2 aria-hidden="true" />Documents &amp; vehicle</button>
          <button type="button" onClick={() => navigate("/driver/account")}><Settings aria-hidden="true" />Settings</button>
          <button type="button" onClick={() => navigate("/driver/contact")}><Headphones aria-hidden="true" />Help &amp; safety</button>
        </div>
        <footer className="driver-drawer-footer">
          <button type="button" onClick={() => navigate("/driver/privacy-policy")}>Privacy Policy</button>
          <button type="button" onClick={() => navigate("/driver/terms")}>Terms and Conditions</button>
          <button type="button" onClick={() => navigate("/driver/contact")}>Contact support</button>
          <button type="button" className="is-danger" onClick={onLogout}><LogOut aria-hidden="true" />Log out</button>
        </footer>
      </aside>
    </div>
  );
}

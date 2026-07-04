"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "moovu:customer-launch-notice:2026-07-07";
const NOTICE_EXPIRES_AT = Date.parse("2026-07-08T00:00:00+02:00");

function isCustomerSurface() {
  const hostname = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  if (hostname.startsWith("driver.") || hostname.startsWith("admin.")) return false;
  if (pathname.startsWith("/driver") || pathname.startsWith("/admin")) return false;

  return (
    pathname === "/" ||
    pathname.startsWith("/book") ||
    pathname.startsWith("/customer") ||
    pathname.startsWith("/ride") ||
    pathname.startsWith("/account")
  );
}

export default function CustomerLaunchNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!isCustomerSurface() || Date.now() >= NOTICE_EXPIRES_AT) return;

      try {
        if (window.localStorage.getItem(DISMISS_KEY) === "dismissed") return;
      } catch {}

      setVisible(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "dismissed");
    } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      className="fixed left-1/2 z-[9000] w-[calc(100%-24px)] max-w-sm -translate-x-1/2 rounded-2xl border border-sky-200 bg-white/95 p-4 shadow-2xl backdrop-blur-xl"
      style={{ top: "calc(72px + env(safe-area-inset-top))" }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--moovu-primary)]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black text-slate-950">Final improvements underway</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
            MOOVU is completing its final improvements and is expected to be fully operational on Tuesday, 7 July. You can close this message and continue booking.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-xl font-bold text-slate-600"
          aria-label="Close launch notice"
        >
          ×
        </button>
      </div>
    </aside>
  );
}

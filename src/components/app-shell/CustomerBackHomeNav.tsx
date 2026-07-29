"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type CustomerBackHomeNavProps = {
  fallbackHref?: string;
  homeHref?: string;
  homeLabel?: string;
  compact?: boolean;
};

export default function CustomerBackHomeNav({
  fallbackHref = "/book",
  homeHref = "/book",
  homeLabel = "Book ride",
  compact = false,
}: CustomerBackHomeNavProps) {
  const router = useRouter();

  function goBack() {
    const hasSameOriginReferrer = (() => {
      try {
        return Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
      } catch {
        return false;
      }
    })();

    if (hasSameOriginReferrer && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }

  return (
    <nav
      className={`flex items-center justify-between gap-2${compact ? "" : " min-h-11 gap-3"}`}
      aria-label="Customer page navigation"
    >
      <button
        type="button"
        onClick={goBack}
        className={`inline-flex items-center rounded-full border border-slate-200 bg-white font-black text-slate-700 shadow-sm transition active:scale-[0.98] ${
          compact ? "h-10 w-10 justify-center p-0 text-base" : "min-h-11 gap-2 px-4 text-sm"
        }`}
        aria-label="Go back"
      >
        <span aria-hidden="true">&larr;</span>
        {compact ? <span className="sr-only">Back</span> : "Back"}
      </button>
      <Link
        href={homeHref}
        className={`inline-flex items-center rounded-full bg-blue-50 font-black text-blue-700 transition active:scale-[0.98] ${
          compact ? "min-h-10 px-3 text-xs" : "min-h-11 px-4 text-sm"
        }`}
      >
        {homeLabel}
      </Link>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type CustomerBackHomeNavProps = {
  fallbackHref?: string;
  homeHref?: string;
  homeLabel?: string;
};

export default function CustomerBackHomeNav({
  fallbackHref = "/book",
  homeHref = "/book",
  homeLabel = "Book ride",
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
    <nav className="flex min-h-11 items-center justify-between gap-3" aria-label="Customer page navigation">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition active:scale-[0.98]"
        aria-label="Go back"
      >
        <span aria-hidden="true">&larr;</span>
        Back
      </button>
      <Link
        href={homeHref}
        className="inline-flex min-h-11 items-center rounded-full bg-blue-50 px-4 text-sm font-black text-blue-700 transition active:scale-[0.98]"
      >
        {homeLabel}
      </Link>
    </nav>
  );
}

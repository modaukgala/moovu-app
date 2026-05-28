"use client";

import Image from "next/image";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="moovu-auth-shell text-black">
      <section className="moovu-auth-card text-center">
        <Image
          src="/logo.png"
          alt="MOOVU Kasi Rides"
          width={96}
          height={96}
          priority
          className="mx-auto mb-4 h-20 w-20 rounded-3xl object-contain shadow-sm"
        />
        <div className="moovu-chip mx-auto w-fit">
          <span className="moovu-chip-dot" />
          MOOVU
        </div>
        <h1 className="mt-4 text-2xl font-black text-slate-950">
          Something interrupted this screen
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Reload this screen and continue. If you were on an active trip, open the trip again from your history or portal.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button type="button" className="moovu-btn moovu-btn-primary" onClick={reset}>
            Try again
          </button>
          <button
            type="button"
            className="moovu-btn moovu-btn-secondary"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </div>
      </section>
    </main>
  );
}

"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="moovu-auth-shell text-black">
          <section className="moovu-auth-card text-center">
            <div className="moovu-chip mx-auto w-fit">
              <span className="moovu-chip-dot" />
              MOOVU
            </div>
            <h1 className="mt-4 text-2xl font-black text-slate-950">
              We need to reload this screen
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              A temporary app screen error occurred. Your trip data is stored safely, so reload the screen and continue.
            </p>
            {error.digest ? (
              <p className="mt-2 text-xs font-semibold text-slate-400">
                Reference: {error.digest}
              </p>
            ) : null}
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
      </body>
    </html>
  );
}

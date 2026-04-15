export default function GlobalLoading() {
  return (
    <main className="moovu-page">
      <div className="moovu-shell space-y-5">
        <div className="moovu-card p-6">
          <div className="moovu-skeleton h-4 w-28" />
          <div className="mt-4 moovu-skeleton h-10 w-72" />
          <div className="mt-4 moovu-skeleton h-5 w-full max-w-2xl" />
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="moovu-card p-5">
            <div className="moovu-skeleton h-5 w-32" />
            <div className="mt-4 moovu-skeleton h-24 w-full" />
          </div>

          <div className="moovu-card p-5">
            <div className="moovu-skeleton h-5 w-32" />
            <div className="mt-4 moovu-skeleton h-24 w-full" />
          </div>

          <div className="moovu-card p-5">
            <div className="moovu-skeleton h-5 w-32" />
            <div className="mt-4 moovu-skeleton h-24 w-full" />
          </div>
        </div>

        <div className="moovu-card p-6">
          <div className="moovu-skeleton h-[320px] w-full" />
        </div>
      </div>
    </main>
  );
}
export default function GlobalLoading() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-4">
        <div
          className="mx-auto h-20 w-20 rounded-3xl flex items-center justify-center shadow-sm border bg-white"
        >
          <img
            src="/icon-192.png"
            alt="MOOVU"
            className="h-12 w-12 object-contain"
          />
        </div>

        <div>
          <h1 className="text-2xl font-semibold text-black">MOOVU Kasi Rides</h1>
          <p className="text-gray-600 mt-1">Loading your experience...</p>
        </div>

        <div className="flex justify-center">
          <div
            className="h-2 w-28 rounded-full overflow-hidden"
            style={{ background: "rgba(47,128,237,0.18)" }}
          >
            <div
              className="h-full w-1/2 rounded-full animate-pulse"
              style={{ background: "var(--moovu-primary)" }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
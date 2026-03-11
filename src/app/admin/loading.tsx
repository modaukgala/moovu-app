export default function AdminLoading() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <img src="/icon-192.png" alt="MOOVU" className="h-14 w-14 mx-auto object-contain" />
        <h1 className="text-2xl font-semibold text-black">MOOVU Admin</h1>
        <p className="text-gray-600">Loading operations dashboard...</p>
      </div>
    </main>
  );
}
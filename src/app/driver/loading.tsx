import Image from "next/image";

export default function AdminLoading() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <Image src="/icon-192.png" alt="MOOVU" width={56} height={56} className="mx-auto object-contain" />
        <h1 className="text-2xl font-semibold text-black">MOOVU Driver</h1>
        <p className="text-gray-600">Loading operations dashboard...</p>
      </div>
    </main>
  );
}

"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function RideConfirmPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const router = useRouter();

  useEffect(() => {
    if (!tripId) return;

    const timer = setTimeout(() => {
      router.push(`/ride/${tripId}`);
    }, 3000);

    return () => clearTimeout(timer);
  }, [tripId, router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="border rounded-2xl p-8 max-w-md w-full text-center space-y-5">
        <h1 className="text-2xl font-semibold">Ride Requested 🚗</h1>

        <p className="opacity-70">
          We are now searching for a driver near you.
        </p>

        <div className="border rounded-xl p-4">
          <div className="text-sm opacity-70">Trip ID</div>
          <div className="font-medium break-all">{tripId}</div>
        </div>

        <button
          className="border rounded-xl px-4 py-3 w-full"
          onClick={() => router.push(`/ride/${tripId}`)}
        >
          Track My Ride
        </button>

        <p className="text-xs opacity-60">
          You will be redirected automatically in a few seconds.
        </p>
      </div>
    </main>
  );
}
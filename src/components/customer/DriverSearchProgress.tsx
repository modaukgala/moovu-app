"use client";

import { useCallback, useEffect, useState } from "react";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";

type SearchStatus = {
  searching: boolean;
  elapsedSeconds: number;
  remainingSeconds: number;
  round: number;
  driversOffered: number;
  driversNearby: number;
};

const ROUND_SECONDS = 40;
const POLL_MS = 10_000;

function mmss(total: number) {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Transparent driver-search progress for customers. Refreshes every 10s, shows
 * honest counts, and after the first 40-second round offers (once) to keep
 * searching in the background with a push when a driver accepts.
 */
export default function DriverSearchProgress({
  tripId,
  getAccessToken,
}: {
  tripId: string;
  getAccessToken: () => Promise<string>;
}) {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [tick, setTick] = useState(0);
  const [notifyChosen, setNotifyChosen] = useState(() => {
    try { return window.localStorage.getItem(`moovu:search-notify:${tripId}`) === "1"; } catch { return false; }
  });

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch(`/api/customer/trip-search-status?tripId=${encodeURIComponent(tripId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (json?.ok) { setStatus(json); setTick(0); }
  }, [getAccessToken, tripId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const poll = setInterval(() => void load(), POLL_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(clock); };
  }, [load]);

  if (!status?.searching) return null;

  const elapsed = status.elapsedSeconds + tick;
  const remaining = Math.max(0, status.remainingSeconds - tick);
  const roundProgress = ((elapsed % ROUND_SECONDS) / ROUND_SECONDS) * 100;
  const showKeepSearching = elapsed >= ROUND_SECONDS && !notifyChosen;

  const chooseNotify = () => {
    try { window.localStorage.setItem(`moovu:search-notify:${tripId}`, "1"); } catch {}
    setNotifyChosen(true);
  };

  const nearbyText = status.driversNearby === 0
    ? "No drivers are online close to you right now. We'll keep trying."
    : `${status.driversNearby} driver${status.driversNearby === 1 ? " is" : "s are"} online near you.`;

  return (
    <section className="moovu-card moovu-search-card p-4" aria-live="polite">
      <div className="moovu-search-head">
        <span className="moovu-search-pulse" aria-hidden="true"><span>🚗</span></span>
        <div className="min-w-0">
          <p className="moovu-search-title">Finding your driver</p>
          <p className="moovu-search-sub">
            Offered to {status.driversOffered} driver{status.driversOffered === 1 ? "" : "s"} nearby · {mmss(elapsed)}
          </p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100">
        <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${roundProgress}%` }} />
      </div>
      <p className="moovu-search-tip">Hang tight. We&apos;re finding the best driver for you now.</p>
      <ul className="mt-3 space-y-1 text-sm font-semibold text-slate-700">
        <li>Round {Math.floor(elapsed / ROUND_SECONDS) + 1}: offered to {status.driversOffered} driver{status.driversOffered === 1 ? "" : "s"} so far.</li>
        <li>{nearbyText}</li>
        <li className="text-slate-500">If no driver accepts within {mmss(remaining)}, we&apos;ll close the request. You won&apos;t be charged.</li>
      </ul>

      {showKeepSearching && (
        <div className="mt-4 rounded-2xl bg-blue-50 p-4">
          <p className="text-sm font-black text-blue-900">Still looking. Keep searching and get notified?</p>
          <p className="mt-1 text-sm text-blue-800">You can leave the app. We&apos;ll send you a notification the moment a driver accepts.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <EnableNotificationsButton role="customer" variant="inline" onEnabled={chooseNotify} />
            <button type="button" className="moovu-btn moovu-btn-secondary" onClick={chooseNotify}>Keep searching</button>
          </div>
        </div>
      )}
      {notifyChosen && (
        <p className="mt-3 text-sm font-bold text-emerald-700">✓ Still searching. We&apos;ll notify you when a driver accepts.</p>
      )}
    </section>
  );
}

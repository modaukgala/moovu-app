"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

export default function RateTripPage() {
  const params = useParams<{ tripId: string }>();
  const router = useRouter();

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submitRating() {
    setBusy(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace(`/customer/auth?next=/ride/${params.tripId}/rate`);
      return;
    }

    const res = await fetch("/api/customer/rate-trip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tripId: params.tripId,
        rating,
        comment,
      }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to submit rating.");
      setBusy(false);
      return;
    }

    setMsg("Thank you for rating your trip.");
    setBusy(false);

    setTimeout(() => {
      router.push(`/ride/${params.tripId}`);
    }, 900);
  }

  return (
    <main className="moovu-app-screen">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-app-container max-w-2xl space-y-5">
        <section className="moovu-app-card overflow-hidden p-0">
          <div className="moovu-customer-task-hero">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="moovu-section-title">MOOVU Rating</div>
                <h1 className="mt-2 text-3xl font-black">Rate your driver</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Your feedback helps MOOVU keep trips reliable, respectful, and safe.
                </p>
              </div>
              <Link href={`/ride/${params.tripId}`} className="moovu-btn moovu-btn-secondary">
                Back
              </Link>
            </div>
          </div>
        </section>

        <section className="moovu-app-card p-5 sm:p-6">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">Rating</span>
              <select
                className="moovu-input bg-white"
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
              >
                <option value={5}>5 - Excellent</option>
                <option value={4}>4 - Good</option>
                <option value={3}>3 - Average</option>
                <option value={2}>2 - Poor</option>
                <option value={1}>1 - Very poor</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">Comment</span>
              <textarea
                className="moovu-input min-h-[140px] resize-none"
                placeholder="Optional feedback"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>

            <button onClick={submitRating} disabled={busy} className="moovu-btn moovu-btn-primary w-full justify-center">
              {busy ? "Submitting..." : "Submit rating"}
            </button>
          </div>
        </section>
      </div>
      <CustomerBottomNav />
    </main>
  );
}

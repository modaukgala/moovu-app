"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">MOOVU Rating</div>
            <h1 className="text-3xl font-semibold mt-1">Rate Your Driver</h1>
          </div>

          <Link href={`/ride/${params.tripId}`} className="border rounded-xl px-4 py-2">
            Back
          </Link>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-2">Rating</label>
            <select
              className="w-full border rounded-xl p-3 bg-white"
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            >
              <option value={5}>5 - Excellent</option>
              <option value={4}>4 - Good</option>
              <option value={3}>3 - Average</option>
              <option value={2}>2 - Poor</option>
              <option value={1}>1 - Very Poor</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">Comment</label>
            <textarea
              className="w-full border rounded-xl p-3 min-h-[140px]"
              placeholder="Optional feedback"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          <button
            onClick={submitRating}
            disabled={busy}
            className="rounded-xl px-4 py-3 text-white"
            style={{ background: "var(--moovu-primary)" }}
          >
            {busy ? "Submitting..." : "Submit Rating"}
          </button>
        </section>
      </div>
    </main>
  );
}
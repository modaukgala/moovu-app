"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

const ISSUE_TYPES = [
  "Driver behavior",
  "Vehicle issue",
  "Wrong route",
  "Safety concern",
  "Payment problem",
  "Other",
];

export default function TripSupportPage() {
  const params = useParams<{ tripId: string }>();
  const router = useRouter();

  const [issueType, setIssueType] = useState(ISSUE_TYPES[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submitIssue() {
    if (!description.trim()) {
      setMsg("Please describe the issue.");
      return;
    }

    setBusy(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace(`/customer/auth?next=/ride/${params.tripId}/support`);
      return;
    }

    const res = await fetch("/api/customer/report-issue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tripId: params.tripId,
        issueType,
        description,
      }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to submit issue.");
      setBusy(false);
      return;
    }

    setMsg("Your issue has been submitted to MOOVU support.");
    setBusy(false);

    setTimeout(() => {
      router.push(`/ride/${params.tripId}`);
    }, 900);
  }

  return (
    <main className="moovu-page pb-28 text-slate-950">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell max-w-2xl space-y-6 py-6">
        <section className="moovu-card overflow-hidden p-0">
          <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="moovu-section-title">MOOVU Support</div>
                <h1 className="mt-2 text-3xl font-black">Report a trip issue</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                  Send a clear support note linked to this trip so MOOVU can review it properly.
                </p>
              </div>
              <Link href={`/ride/${params.tripId}`} className="moovu-btn moovu-btn-secondary">
                Back
              </Link>
            </div>
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">Issue type</span>
            <select
              className="moovu-input bg-white"
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
            >
              {ISSUE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">Description</span>
            <textarea
              className="moovu-input min-h-[140px] resize-none"
              placeholder="Describe what happened"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            </label>

          <button
            onClick={submitIssue}
            disabled={busy}
            className="moovu-btn moovu-btn-primary w-full justify-center"
          >
            {busy ? "Submitting..." : "Submit issue"}
          </button>
          </div>
        </section>
      </div>
      <CustomerBottomNav />
    </main>
  );
}

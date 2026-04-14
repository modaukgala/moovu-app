"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">MOOVU Support</div>
            <h1 className="text-3xl font-semibold mt-1">Report a Trip Issue</h1>
          </div>

          <Link href={`/ride/${params.tripId}`} className="border rounded-xl px-4 py-2">
            Back
          </Link>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-2">Issue type</label>
            <select
              className="w-full border rounded-xl p-3 bg-white"
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
            >
              {ISSUE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">Description</label>
            <textarea
              className="w-full border rounded-xl p-3 min-h-[140px]"
              placeholder="Describe what happened"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <button
            onClick={submitIssue}
            disabled={busy}
            className="rounded-xl px-4 py-3 text-white"
            style={{ background: "var(--moovu-primary)" }}
          >
            {busy ? "Submitting..." : "Submit Issue"}
          </button>
        </section>
      </div>
    </main>
  );
}
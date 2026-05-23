"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

export default function ShareTripPage() {
  const params = useParams<{ tripId: string }>();
  const router = useRouter();

  const [friendName, setFriendName] = useState("");
  const [friendPhone, setFriendPhone] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [whatsappUrl, setWhatsappUrl] = useState("");
  const [smsUrl, setSmsUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function prepareShare() {
    setBusy(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace(`/customer/auth?next=/ride/${params.tripId}/share`);
      return;
    }

    const res = await fetch("/api/customer/share-trip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tripId: params.tripId,
        friendName,
        friendPhone,
        shareMethod: "system_share",
      }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to prepare trip share.");
      setBusy(false);
      return;
    }

    setShareMessage(json.shareMessage || "");
    setShareUrl(json.shareUrl || "");
    setWhatsappUrl(json.whatsappUrl || "");
    setSmsUrl(json.smsUrl || "");
    setMsg("Trip share message prepared successfully.");
    setBusy(false);
  }

  async function shareNow() {
    if (!shareMessage) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "MOOVU Trip Share",
          text: shareMessage,
          url: shareUrl || undefined,
        });
        return;
      } catch {}
    }

    await navigator.clipboard.writeText(shareMessage);
    setMsg("Trip share message copied to clipboard.");
  }

  return (
    <main className="moovu-page pb-28 text-slate-950">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell max-w-3xl space-y-6 py-6">
        <section className="moovu-card overflow-hidden p-0">
          <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="moovu-section-title">MOOVU Share</div>
                <h1 className="mt-2 text-3xl font-black">Share your trip</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                  Sharing becomes available after the start OTP is verified. Send live trip context to someone you trust.
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
          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="moovu-input"
              placeholder="Friend or family member name"
              value={friendName}
              onChange={(e) => setFriendName(e.target.value)}
            />

            <input
              className="moovu-input"
              placeholder="Friend or family cellphone number"
              value={friendPhone}
              onChange={(e) => setFriendPhone(e.target.value)}
            />
          </div>

          <button
            onClick={prepareShare}
            disabled={busy}
            className="moovu-btn moovu-btn-primary w-full justify-center"
          >
            {busy ? "Preparing..." : "Prepare share message"}
          </button>

          {shareMessage && (
            <>
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="mb-2 text-sm font-black text-slate-500">Message preview</div>
                <div className="text-sm leading-7 whitespace-pre-wrap">{shareMessage}</div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={shareNow}
                  className="moovu-btn moovu-btn-primary"
                >
                  Open Share Sheet / Copy
                </button>

                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="moovu-btn moovu-btn-secondary"
                  >
                    Send via WhatsApp
                  </a>
                )}

                {smsUrl && (
                  <a
                    href={smsUrl}
                    className="moovu-btn moovu-btn-secondary"
                  >
                    Send via SMS
                  </a>
                )}
              </div>

              {shareUrl && (
                <div className="rounded-3xl bg-slate-50 p-4">
                  <div className="mb-2 text-sm font-black text-slate-500">Live shared trip link</div>
                  <div className="break-all text-sm">{shareUrl}</div>
                </div>
              )}
            </>
          )}
          </div>
        </section>
      </div>
      <CustomerBottomNav />
    </main>
  );
}

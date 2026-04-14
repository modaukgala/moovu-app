"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">MOOVU Share</div>
            <h1 className="text-3xl font-semibold mt-1">Share Your Trip</h1>
            <p className="text-gray-700 mt-2">
              Sharing is only available after the trip has started and the start OTP has been verified.
            </p>
          </div>

          <Link href={`/ride/${params.tripId}`} className="border rounded-xl px-4 py-2">
            Back
          </Link>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border rounded-xl p-3"
              placeholder="Friend or family member name"
              value={friendName}
              onChange={(e) => setFriendName(e.target.value)}
            />

            <input
              className="border rounded-xl p-3"
              placeholder="Friend or family cellphone number"
              value={friendPhone}
              onChange={(e) => setFriendPhone(e.target.value)}
            />
          </div>

          <button
            onClick={prepareShare}
            disabled={busy}
            className="rounded-xl px-4 py-3 text-white"
            style={{ background: "var(--moovu-primary)" }}
          >
            {busy ? "Preparing..." : "Prepare Share Message"}
          </button>

          {shareMessage && (
            <>
              <div className="border rounded-xl p-4 bg-gray-50">
                <div className="text-sm text-gray-500 mb-2">Message preview</div>
                <div className="text-sm leading-7 whitespace-pre-wrap">{shareMessage}</div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={shareNow}
                  className="rounded-xl px-4 py-3 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                >
                  Open Share Sheet / Copy
                </button>

                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="border rounded-xl px-4 py-3"
                  >
                    Send via WhatsApp
                  </a>
                )}

                {smsUrl && (
                  <a
                    href={smsUrl}
                    className="border rounded-xl px-4 py-3"
                  >
                    Send via SMS
                  </a>
                )}
              </div>

              {shareUrl && (
                <div className="border rounded-xl p-4 bg-gray-50">
                  <div className="text-sm text-gray-500 mb-2">Live shared trip link</div>
                  <div className="break-all text-sm">{shareUrl}</div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
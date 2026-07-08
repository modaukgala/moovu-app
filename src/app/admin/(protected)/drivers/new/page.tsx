"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { ActionCard, PageHeader, ProfileSectionCard } from "@/components/ui/MoovuPrimitives";

export default function NewDriverPage() {

  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDriver(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session?.access_token) {
      setError("Please sign in as an admin to create drivers.");
      setBusy(false);
      return;
    }

    const res = await fetch("/api/admin/drivers/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        firstName,
        lastName,
        phone,
        email,
      }),
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setError(json?.error || "Could not create driver. Please check the details and try again.");
      setBusy(false);
      return;
    }

    router.push("/admin/drivers");
  }

  return (
    <main className="space-y-5">
      {error && <CenteredMessageBox title="Create driver failed" message={error} onClose={() => setError(null)} />}

      <PageHeader
        kicker="Driver operations"
        title="Add Driver"
        description="Create a driver profile from the admin portal. The driver still keeps the normal approval, document and subscription checks before receiving trips."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ProfileSectionCard
          title="Driver details"
          description="Capture the basic contact details needed to create the driver record."
        >
          <form onSubmit={createDriver} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="moovu-field-label">
                First name
                <input
                  className="moovu-input"
                  placeholder="Gift"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </label>

              <label className="moovu-field-label">
                Last name
                <input
                  className="moovu-input"
                  placeholder="Driver"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="moovu-field-label">
                Cellphone
                <input
                  className="moovu-input"
                  placeholder="07..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>

              <label className="moovu-field-label">
                Email
                <input
                  className="moovu-input"
                  placeholder="driver@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </div>

            <div className="moovu-sticky-safe-action mt-2">
              <button disabled={busy} className="moovu-btn moovu-btn-primary w-full sm:w-auto">
                {busy ? "Creating..." : "Create Driver"}
              </button>
            </div>
          </form>
        </ProfileSectionCard>

        <ActionCard
          tone="primary"
          meta="Review path"
          title="Approval stays protected"
          description="Creating this record does not bypass verification, document review, subscription checks, or online eligibility."
        />
      </div>
    </main>
  );
}

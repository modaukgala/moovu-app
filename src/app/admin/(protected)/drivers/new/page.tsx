"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

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
    <main className="p-6">
      {error && <CenteredMessageBox title="Create driver failed" message={error} onClose={() => setError(null)} />}

      <h1 className="text-2xl font-semibold mb-6">Add Driver</h1>

      <form onSubmit={createDriver} className="space-y-4 max-w-md">

        <input
          className="w-full border rounded-xl p-3"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />

        <input
          className="w-full border rounded-xl p-3"
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />

        <input
          className="w-full border rounded-xl p-3"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <input
          className="w-full border rounded-xl p-3"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button disabled={busy} className="border rounded-xl px-4 py-2">
          {busy ? "Creating..." : "Create Driver"}
        </button>

      </form>

    </main>
  );
}

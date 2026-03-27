"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type DriverOpt = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  created_at: string | null;
};

export default function AdminLinkDriverAccountPage() {
  const [email, setEmail] = useState("");
  const [driverId, setDriverId] = useState("");

  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }

  async function loadDrivers() {
    setLoadingDrivers(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setMsg("You are not logged in.");
      setLoadingDrivers(false);
      return;
    }

    const res = await fetch("/api/admin/drivers/options", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const json = await res.json();

    if (!json.ok) {
      setDrivers([]);
      setMsg(json.error || "Failed to load drivers");
      setLoadingDrivers(false);
      return;
    }

    setDrivers(json.drivers ?? []);
    setLoadingDrivers(false);
  }

  useEffect(() => {
    loadDrivers();
  }, []);

  const driverLabel = useMemo(() => {
    const d = drivers.find((x) => x.id === driverId);
    if (!d) return null;
    const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
    return `${name} • ${d.phone ?? "—"} • ${d.status ?? "—"} ${d.online ? "• online" : ""} ${d.busy ? "• busy" : ""}`;
  }, [drivers, driverId]);

  async function link() {
    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch("/api/admin/drivers/link-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: "link",
        email: email.trim(),
        driverId: driverId.trim(),
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Link failed");
      return;
    }

    setMsg(`✅ Linked: ${email.trim()} → ${driverId.trim()}`);
  }

  async function unlink() {
    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch("/api/admin/drivers/link-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: "unlink",
        email: email.trim(),
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Unlink failed");
      return;
    }

    setMsg(`✅ Unlinked: ${email.trim()}`);
  }

  return (
    <main className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Link Driver Account</h1>
        <p className="opacity-70 mt-1">
          Link a driver login email to a Driver UUID so they can use the driver portal.
        </p>
      </div>

      {msg && <div className="border rounded-2xl p-4 text-sm">{msg}</div>}

      <section className="border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Driver Login Email</h2>

        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Driver email in Supabase Auth"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="text-xs opacity-60">
          This must match the email the driver used to sign up.
        </div>
      </section>

      <section className="border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Choose Driver UUID</h2>

        <div className="grid md:grid-cols-2 gap-3">
          <select
            className="border rounded-xl p-3 bg-transparent"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          >
            <option value="">
              {loadingDrivers ? "Loading drivers..." : "Select driver..."}
            </option>
            {drivers.map((d) => {
              const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
              const label = `${name} • ${d.phone ?? "—"} • ${d.id}`;
              return (
                <option key={d.id} value={d.id}>
                  {label}
                </option>
              );
            })}
          </select>

          <input
            className="border rounded-xl p-3"
            placeholder="Or paste Driver UUID here"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          />
        </div>

        {driverLabel && <div className="text-sm opacity-70">Selected: {driverLabel}</div>}

        <div className="flex flex-wrap gap-2">
          <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={link}>
            {busy ? "Working..." : "Link"}
          </button>
          <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={unlink}>
            {busy ? "Working..." : "Unlink"}
          </button>
          <button className="border rounded-xl px-4 py-2" disabled={loadingDrivers} onClick={loadDrivers}>
            Refresh Drivers
          </button>
        </div>
      </section>
    </main>
  );
}
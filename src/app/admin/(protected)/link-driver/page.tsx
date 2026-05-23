"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";

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

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadDrivers = useCallback(async () => {
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
  }, [getAccessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDrivers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDrivers]);

  const driverLabel = useMemo(() => {
    const d = drivers.find((x) => x.id === driverId);
    if (!d) return null;
    const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
    return `${name} - ${d.phone ?? "--"} - ${d.status ?? "--"} ${d.online ? "- online" : ""} ${
      d.busy ? "- busy" : ""
    }`;
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

    setMsg(`Linked: ${email.trim()} -> ${driverId.trim()}`);
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

    setMsg(`Unlinked: ${email.trim()}`);
  }

  return (
    <main className="moovu-page min-h-screen text-slate-950">
      <div className="moovu-shell max-w-4xl space-y-6 py-6 sm:py-8">
        <section className="moovu-card overflow-hidden p-0">
          <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 sm:p-7">
            <div className="moovu-section-title">Admin Driver Access</div>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Link Driver Account</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Link a Supabase Auth email to an approved driver record so the driver can use the MOOVU driver portal.
            </p>
          </div>
        </section>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        <section className="moovu-card p-5 sm:p-6">
          <div className="moovu-section-title">Driver Login Email</div>
          <h2 className="mt-2 text-xl font-black">Auth account</h2>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-black text-slate-700">Driver email in Supabase Auth</span>
            <input
              className="moovu-input w-full"
              placeholder="driver@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <div className="mt-3 text-xs font-semibold text-slate-500">
            This must match the email the driver used to sign up.
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6">
          <div className="moovu-section-title">Driver Record</div>
          <h2 className="mt-2 text-xl font-black">Choose Driver UUID</h2>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select
              className="moovu-input bg-white"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">
                {loadingDrivers ? "Loading drivers..." : "Select driver..."}
              </option>
              {drivers.map((d) => {
                const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
                const label = `${name} - ${d.phone ?? "--"} - ${d.id}`;
                return (
                  <option key={d.id} value={d.id}>
                    {label}
                  </option>
                );
              })}
            </select>

            <input
              className="moovu-input"
              placeholder="Or paste Driver UUID here"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            />
          </div>

          {driverLabel ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">
              <span className="font-black">Selected:</span>
              <span>{driverLabel}</span>
              <StatusBadge status={drivers.find((x) => x.id === driverId)?.status} />
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                title="No driver selected"
                description="Select a driver from the list or paste a driver UUID to link the account."
              />
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button className="moovu-btn moovu-btn-primary" disabled={busy} onClick={link}>
              {busy ? "Working..." : "Link"}
            </button>
            <button className="moovu-btn moovu-btn-secondary" disabled={busy} onClick={unlink}>
              {busy ? "Working..." : "Unlink"}
            </button>
            <button className="moovu-btn moovu-btn-secondary" disabled={loadingDrivers} onClick={loadDrivers}>
              Refresh Drivers
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

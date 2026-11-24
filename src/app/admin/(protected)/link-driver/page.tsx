"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [driverId, setDriverId] = useState(() => searchParams.get("driverId") ?? "");

  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [existingLink, setExistingLink] = useState<{ userId: string; email: string | null } | null>(null);
  const [targetLogin, setTargetLogin] = useState<{ userId: string; email: string } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

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
    }).catch(() => null);

    const json = res ? await res.json().catch(() => null) : null;

    if (!res?.ok || !json?.ok) {
      setDrivers([]);
      setMsg(json?.error || "Failed to load drivers");
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

  const inspectLink = useCallback(async () => {
    if (!driverId && !email.trim()) return;
    const token = await getAccessToken();
    if (!token) return;
    const params = new URLSearchParams({ driverId: driverId.trim(), email: email.trim() });
    const response = await fetch(`/api/admin/drivers/link-account?${params}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      setLookupError(json?.error || "Account linkage lookup failed.");
      setExistingLink(null); setTargetLogin(null); return;
    }
    setLookupError(null);
    setExistingLink(json.existingLink ?? null);
    setTargetLogin(json.targetLogin ?? null);
  }, [driverId, email, getAccessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void inspectLink(); }, 350);
    return () => window.clearTimeout(timer);
  }, [inspectLink]);

  const driverLabel = useMemo(() => {
    const d = drivers.find((x) => x.id === driverId);
    if (!d) return null;
    const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
    return `${name} - ${d.phone ?? "--"} - ${d.status ?? "--"} ${d.online ? "- online" : ""} ${
      d.busy ? "- busy" : ""
    }`;
  }, [drivers, driverId]);

  async function link() {
    if (!targetLogin) {
      setMsg("Confirm a valid target login email before linking.");
      return;
    }
    if (existingLink && existingLink.userId !== targetLogin.userId && !window.confirm(`Replace the existing link ${existingLink.email ?? existingLink.userId} with ${targetLogin.email}?`)) return;
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
    }).catch(() => null);

    const json = res ? await res.json().catch(() => null) : null;
    setBusy(false);

    if (!res?.ok || !json?.ok) {
      setMsg(json?.error || "Link failed");
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
    }).catch(() => null);

    const json = res ? await res.json().catch(() => null) : null;
    setBusy(false);

    if (!res?.ok || !json?.ok) {
      setMsg(json?.error || "Unlink failed");
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
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">
            <div><strong>Selected driver:</strong> {driverLabel ?? (driverId || "Not selected")}</div>
            <div className="mt-1"><strong>Target login:</strong> {targetLogin ? `${targetLogin.email} · ${targetLogin.userId}` : "No matching Auth user"}</div>
            <div className="mt-1"><strong>Existing linkage:</strong> {existingLink ? `${existingLink.email ?? "Email unavailable"} · ${existingLink.userId}` : "None"}</div>
            {lookupError && <div className="mt-2 font-bold text-amber-800">{lookupError}</div>}
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
